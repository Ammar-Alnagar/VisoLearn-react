import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
// Keep ActionData definition here or import from a shared types file if needed later
import { getGeminiHint } from "~/utils/gemini.server";
interface ActionData {
  hint?: string;
  error?: string;
  gameFinished?: boolean;
  correctFeatures?: string[];
  attemptsRemaining?: number;
  isGameOver?: boolean;
  message?: string; // For simplified action
}

// --- ACTION HANDLER FOR CHAT ---
// This route ONLY handles POST requests for chat messages
export const action = async ({ request }: ActionFunctionArgs) => {
  // Ensure it's a POST request (Remix usually handles this, but good practice)
  if (request.method !== "POST") {
    return json({ error: "Method Not Allowed" }, { status: 405 });
  }

  console.log("--- API CHAT ACTION HANDLER HIT ---"); // Log to confirm it's reached
  try {
    const formData = await request.formData();
    const userAttempt = formData.get("userAttempt") as string;
    console.log("API Chat Action: User Attempt Received:", userAttempt);

    // Get necessary data from form
    const imageFeatures = JSON.parse(formData.get("imageFeatures") as string || '[]');
    const chatHistory = JSON.parse(formData.get("chatHistory") as string || '[]');
      // Format chat history for Gemini API
      const formattedChatHistory = chatHistory.map((entry: any) => ({
          role: entry.role === 'user' ? 'user' : 'model',
          parts: [{ text: entry.text }]
      }));
    const attemptsRemaining = parseInt(formData.get("attemptsRemaining") as string || '0', 10);

    // Get hint from Gemini
    const hint = await getGeminiHint(imageFeatures, userAttempt, formattedChatHistory);
    
    // Check if any features were identified in this attempt
    const lowerAttempt = userAttempt.toLowerCase();
    const newlyFoundFeatures = imageFeatures.filter(
      (feature: string) => 
        feature.toLowerCase().includes(lowerAttempt) || 
        lowerAttempt.includes(feature.toLowerCase())
    );

    // Update game state
    const updatedCorrectFeatures = [
      ...JSON.parse(formData.get("correctFeatures") as string || '[]'),
      ...newlyFoundFeatures
    ];
    const updatedAttemptsRemaining = attemptsRemaining - 1;
    const winThreshold = parseInt(formData.get("winThreshold") as string || '4', 10);
    const gameFinished = 
      updatedCorrectFeatures.length >= winThreshold || 
      updatedAttemptsRemaining <= 0;

    return json<ActionData>({
      message: hint,
      correctFeatures: updatedCorrectFeatures,
      attemptsRemaining: updatedAttemptsRemaining,
      gameFinished,
      isGameOver: updatedAttemptsRemaining <= 0
    });

  } catch (error) {
    console.error("API Chat Action: Error processing request:", error);
    return json<ActionData>({ error: "Failed to process chat message." }, { status: 500 });
  }
};

// Optional: Add a loader that explicitly denies GET requests if you want
// export const loader = () => {
//   throw new Response("Not Found", { status: 404 });
// };
