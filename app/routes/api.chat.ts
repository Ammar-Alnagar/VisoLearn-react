import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getGeminiHint, type ChatEntry } from "~/utils/gemini.server"; // Import ChatEntry type

// Interface for the data expected from the client fetcher
interface FetcherFormData {
  userAttempt: string;
  imageFeatures: string[]; // Sent as JSON string
  chatHistory: ChatEntry[]; // Sent as JSON string
  correctFeatures: string[]; // Sent as JSON string
  attemptsRemaining: number; // Sent as string
  winThreshold: number; // Sent as string (though not directly used for game end anymore)
}

// Interface for the data returned by this action
interface ActionResponseData {
  message?: string; // Combined hint/response message
  error?: string;
  gameTrulyFinished?: boolean; // Renamed from gameFinished for clarity
  allFeaturesFound?: boolean; // Explicit flag if all features were found
  correctFeatures?: string[];
  attemptsRemaining?: number;
  newlyFoundFeatures?: string[]; // Explicitly tell UI which features were just found
}

// --- ACTION HANDLER FOR CHAT ---
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json<ActionResponseData>(
      { error: "Method Not Allowed" },
      { status: 405 }
    );
  }

  console.log("--- API CHAT ACTION HANDLER ---");
  try {
    const formData = await request.formData();

    // --- Extract and Parse Data ---
    const userAttempt = formData.get("userAttempt") as string;
    if (!userAttempt) {
      return json<ActionResponseData>(
        { error: "Missing user attempt." },
        { status: 400 }
      );
    }

    let imageFeatures: string[];
    let chatHistory: ChatEntry[];
    let correctFeatures: string[];
    let attemptsRemaining: number;
    // let winThreshold: number; // We still receive it but don't use it for the end condition

    try {
      imageFeatures = JSON.parse(
        (formData.get("imageFeatures") as string) || "[]"
      );
      const rawChatHistory = JSON.parse(
        (formData.get("chatHistory") as string) || "[]"
      );
      chatHistory = rawChatHistory.map((entry: any) => ({
        role: entry.role === "user" ? "user" : "model",
        // Ensure parts structure is correct, handling potential variations
        parts: Array.isArray(entry.parts)
          ? entry.parts.map((part: any) => ({ text: part.text || "" }))
          : [{ text: "" }],
      }));
      correctFeatures = JSON.parse(
        (formData.get("correctFeatures") as string) || "[]"
      );
      attemptsRemaining = parseInt(
        (formData.get("attemptsRemaining") as string) || "0",
        10
      );
      // winThreshold = parseInt(formData.get("winThreshold") as string || '4', 10); // Parse if needed elsewhere
    } catch (parseError) {
      console.error("API Chat Action: Error parsing form data:", parseError);
      return json<ActionResponseData>(
        { error: "Invalid data format received." },
        { status: 400 }
      );
    }

    // Basic validation
    if (
      !Array.isArray(imageFeatures) ||
      !Array.isArray(chatHistory) ||
      !Array.isArray(correctFeatures)
    ) {
      return json<ActionResponseData>(
        { error: "Invalid data structure received." },
        { status: 400 }
      );
    }
    if (isNaN(attemptsRemaining)) {
      return json<ActionResponseData>(
        { error: "Invalid attempts remaining value." },
        { status: 400 }
      );
    }

    console.log("API Chat Action: Received Data:", {
      userAttempt,
      imageFeatures,
      chatHistory,
      correctFeatures,
      attemptsRemaining,
    });

    // --- Get Hint from Gemini ---
    // Ensure history sent to Gemini is valid
    const validChatHistory = chatHistory.filter(
      (entry) =>
        entry.role &&
        Array.isArray(entry.parts) &&
        entry.parts.every((part) => typeof part.text === "string")
    );

    // Modified feature matching and attempts logic
    const lowerAttempt = userAttempt.toLowerCase().trim();
    const currentCorrectFeaturesLower = correctFeatures.map((f) =>
      f.toLowerCase()
    );

    // Find any new features in this attempt
    const newlyFoundFeatures = imageFeatures
      .filter((feature: string) => {
        const lowerFeature = feature.toLowerCase().trim();

        // Skip if already found
        if (currentCorrectFeaturesLower.includes(lowerFeature)) {
          return false;
        }

        // More precise matching logic
        return (
          // Exact match
          lowerAttempt === lowerFeature ||
          // Feature is a complete word/phrase within attempt
          new RegExp("\\b(type of ears|folded)\\b").test(lowerFeature) ||
          // Attempt is a complete word/phrase within feature
          new RegExp(`\\b${lowerAttempt}\\b`).test(lowerFeature)
        );
      })
      .map((f) => f.toLowerCase());

    // Create updated features list with original casing
    const updatedCorrectFeatures = [
      ...correctFeatures,
      ...imageFeatures.filter((f) =>
        newlyFoundFeatures.includes(f.toLowerCase())
      ),
    ];
    const uniqueCorrectFeatures = [...new Set(updatedCorrectFeatures)];

    // Only decrement attempts if no new features were found AND it wasn't a help request
    const isHelpRequest =
      lowerAttempt.includes("help") ||
      lowerAttempt.includes("hint") ||
      lowerAttempt.includes("clue");

    const shouldDecrementAttempts =
      newlyFoundFeatures.length === 0 && !isHelpRequest;
    const updatedAttemptsRemaining = shouldDecrementAttempts
      ? Math.max(0, attemptsRemaining - 1)
      : attemptsRemaining;

    // --- Determine End Conditions ---
    const allFeaturesFound =
      uniqueCorrectFeatures.length === imageFeatures.length;
    const loseConditionMet = updatedAttemptsRemaining <= 0;
    const gameTrulyFinished = allFeaturesFound || loseConditionMet; // Game ends if ALL features found OR attempts run out

    const hint = await getGeminiHint(
      imageFeatures,
      userAttempt,
      validChatHistory
    );
    console.log("API Chat Action: Gemini Hint:", hint);

    // Construct response message
    let responseMessage = hint;
    if (newlyFoundFeatures.length > 0) {
      const foundFeaturesList = newlyFoundFeatures
        .map((f) => imageFeatures.find((orig) => orig.toLowerCase() === f))
        .filter(Boolean)
        .join(", ");

      responseMessage =
        `Yes! You found: ${foundFeaturesList}! ` +
        `(${uniqueCorrectFeatures.length}/${imageFeatures.length} features found) ` +
        (hint ? `\n${hint}` : "");
    }

    // --- Return Response ---
    return json<ActionResponseData>({
      message: responseMessage, // Send the hint back
      correctFeatures: uniqueCorrectFeatures, // Send the updated list
      attemptsRemaining: updatedAttemptsRemaining,
      allFeaturesFound: allFeaturesFound, // Indicate if all were found
      gameTrulyFinished: gameTrulyFinished, // Indicate if the game should stop interaction
      // Add new field to explicitly tell UI which features were just found
      newlyFoundFeatures:
        newlyFoundFeatures.length > 0
          ? newlyFoundFeatures.map(
              (f) => imageFeatures.find((orig) => orig.toLowerCase() === f)!
            )
          : [],
    });
  } catch (error) {
    console.error("API Chat Action: Error processing request:", error);
    if (error instanceof Error && error.message.includes("SAFETY")) {
      return json<ActionResponseData>(
        { error: "Content blocked due to safety settings." },
        { status: 400 }
      );
    }
    return json<ActionResponseData>(
      { error: "Failed to process chat message." },
      { status: 500 }
    );
  }
};
