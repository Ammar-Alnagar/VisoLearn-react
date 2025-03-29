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
    const hint = await getGeminiHint(
      imageFeatures,
      userAttempt,
      validChatHistory
    );
    console.log("API Chat Action: Gemini Hint:", hint);

    // --- Update Game State ---
    const lowerAttempt = userAttempt.toLowerCase().trim(); // Trim whitespace
    const currentCorrectFeaturesLower = correctFeatures.map((f) =>
      f.toLowerCase()
    ); // Use lowercase for checking existence

    // Find newly found features based on the current attempt against ALL image features
    const newlyFoundFeatures = imageFeatures
      .filter((feature: string) => {
        const lowerFeature = feature.toLowerCase();
        // Check if this feature hasn't been found yet
        if (currentCorrectFeaturesLower.includes(lowerFeature)) {
          return false;
        }
        // Check if the attempt *is* the feature or *contains* the feature (case-insensitive)
        // Be more robust: check word boundaries or exact matches if needed, this is simpler
        return (
          lowerAttempt === lowerFeature ||
          lowerAttempt.includes(lowerFeature) ||
          lowerFeature.includes(lowerAttempt)
        );
      })
      .map((f) => f.toLowerCase()); // Store found features in lowercase for consistent checking

    // Create the updated list, ensuring uniqueness implicitly by how newlyFoundFeatures is generated
    const updatedCorrectFeatures = [
      ...correctFeatures, // Keep existing correct features (preserve original casing if desired, though lowercase comparison is key)
      ...imageFeatures.filter((f) =>
        newlyFoundFeatures.includes(f.toLowerCase())
      ), // Add the *original cased* versions of newly found features
    ];
    const uniqueCorrectFeatures = [...new Set(updatedCorrectFeatures)]; // Ensure uniqueness, preserving original case where possible

    // Decrement attempts regardless of finding a feature
    const updatedAttemptsRemaining = Math.max(0, attemptsRemaining - 1); // Ensure it doesn't go below 0

    // --- Determine End Conditions ---
    const allFeaturesFound =
      uniqueCorrectFeatures.length === imageFeatures.length;
    const loseConditionMet = updatedAttemptsRemaining <= 0;
    const gameTrulyFinished = allFeaturesFound || loseConditionMet; // Game ends if ALL features found OR attempts run out

    console.log("API Chat Action: Updated State:", {
      updatedCorrectFeatures: uniqueCorrectFeatures,
      updatedAttemptsRemaining,
      allFeaturesFound,
      gameTrulyFinished,
    });

    // --- Return Response ---
    return json<ActionResponseData>({
      message: hint, // Send the hint back
      correctFeatures: uniqueCorrectFeatures, // Send the updated list
      attemptsRemaining: updatedAttemptsRemaining,
      allFeaturesFound: allFeaturesFound, // Indicate if all were found
      gameTrulyFinished: gameTrulyFinished, // Indicate if the game should stop interaction
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
