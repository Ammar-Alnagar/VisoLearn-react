import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getGeminiHint, type ChatEntry } from "~/utils/gemini.server"; // Import ChatEntry type

// Interface for the data expected from the client fetcher
interface FetcherFormData {
  userAttempt: string;
  imageFeatures: string[]; // Already parsed by client? No, send as JSON string
  chatHistory: ChatEntry[]; // Already parsed by client? No, send as JSON string
  correctFeatures: string[]; // Already parsed by client? No, send as JSON string
  attemptsRemaining: number; // Already parsed by client? No, send as string
  winThreshold: number; // Already parsed by client? No, send as string
}

// Interface for the data returned by this action
interface ActionResponseData {
  message?: string; // Combined hint/response message
  error?: string;
  gameFinished?: boolean;
  correctFeatures?: string[];
  attemptsRemaining?: number;
  isGameOver?: boolean; // Derived from attemptsRemaining <= 0
}

// --- ACTION HANDLER FOR CHAT ---
export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") {
    return json<ActionResponseData>({ error: "Method Not Allowed" }, { status: 405 });
  }

  console.log("--- API CHAT ACTION HANDLER ---");
  try {
    const formData = await request.formData();

    // --- Extract and Parse Data ---
    const userAttempt = formData.get("userAttempt") as string;
    if (!userAttempt) {
        return json<ActionResponseData>({ error: "Missing user attempt." }, { status: 400 });
    }

    let imageFeatures: string[];
    let chatHistory: ChatEntry[];
    let correctFeatures: string[];
    let attemptsRemaining: number;
    let winThreshold: number;

    try {
        imageFeatures = JSON.parse(formData.get("imageFeatures") as string || '[]');
        // Ensure chatHistory is parsed correctly into the ChatEntry structure
        const rawChatHistory = JSON.parse(formData.get("chatHistory") as string || '[]');
        chatHistory = rawChatHistory.map((entry: any) => ({
            role: entry.role === 'user' ? 'user' : 'model',
            parts: entry.parts // Assuming parts are already in the correct [{ text: "..." }] format
        }));
        correctFeatures = JSON.parse(formData.get("correctFeatures") as string || '[]');
        attemptsRemaining = parseInt(formData.get("attemptsRemaining") as string || '0', 10);
        winThreshold = parseInt(formData.get("winThreshold") as string || '4', 10);
    } catch (parseError) {
        console.error("API Chat Action: Error parsing form data:", parseError);
        return json<ActionResponseData>({ error: "Invalid data format received." }, { status: 400 });
    }

    console.log("API Chat Action: Received Data:", { userAttempt, imageFeatures, chatHistory, correctFeatures, attemptsRemaining, winThreshold });

    // --- Get Hint from Gemini ---
    // Pass the correctly formatted chat history
    const hint = await getGeminiHint(imageFeatures, userAttempt, chatHistory);
    console.log("API Chat Action: Gemini Hint:", hint);

    // --- Update Game State ---
    const lowerAttempt = userAttempt.toLowerCase();
    const remainingFeatures = imageFeatures.filter(
        (feature: string) => !correctFeatures.includes(feature.toLowerCase())
    );

    // Find newly found features based on the current attempt against remaining features
    const newlyFoundFeatures = remainingFeatures.filter(
      (feature: string) => {
          const lowerFeature = feature.toLowerCase();
          // Check if the attempt *is* the feature or *contains* the feature (case-insensitive)
          return lowerAttempt === lowerFeature || lowerAttempt.includes(lowerFeature) || lowerFeature.includes(lowerAttempt);
      }
    ).map(f => f.toLowerCase()); // Store found features in lowercase for consistent checking

    const updatedCorrectFeatures = [
      ...correctFeatures, // Keep existing correct features
      ...newlyFoundFeatures // Add newly found unique features
    ];

    // Decrement attempts only if no new feature was found in this attempt?
    // Or always decrement? Let's always decrement for now.
    const updatedAttemptsRemaining = attemptsRemaining - 1;

    const uniqueCorrectFeatures = [...new Set(updatedCorrectFeatures)]; // Ensure uniqueness

    const winConditionMet = uniqueCorrectFeatures.length >= winThreshold;
    const loseConditionMet = updatedAttemptsRemaining <= 0;
    const gameFinished = winConditionMet || loseConditionMet;
    const isGameOver = loseConditionMet && !winConditionMet; // Game over only if attempts ran out *before* winning

    console.log("API Chat Action: Updated State:", { updatedCorrectFeatures: uniqueCorrectFeatures, updatedAttemptsRemaining, gameFinished, isGameOver });

    // --- Return Response ---
    return json<ActionResponseData>({
      message: hint, // Send the hint back
      correctFeatures: uniqueCorrectFeatures,
      attemptsRemaining: updatedAttemptsRemaining,
      gameFinished: gameFinished,
      isGameOver: isGameOver,
    });

  } catch (error) {
    console.error("API Chat Action: Error processing request:", error);
    // Check if it's a specific Gemini error (e.g., safety) - needs more specific error handling if possible
    if (error instanceof Error && error.message.includes('SAFETY')) {
         return json<ActionResponseData>({ error: "Content blocked due to safety settings." }, { status: 400 });
    }
    return json<ActionResponseData>({ error: "Failed to process chat message." }, { status: 500 });
  }
};

// Optional: Add a loader that explicitly denies GET requests if you want
// export const loader = () => {
//   throw new Response("Not Found", { status: 404 });
// };
