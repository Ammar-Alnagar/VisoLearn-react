import type { ActionFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
// Keep ActionData definition here or import from a shared types file if needed later
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

    // Return a simple success message (using the simplified logic for now)
    return json<ActionData>({ message: `API route received: ${userAttempt}` });

    // --- LATER: Restore original action logic here ---
    // const imageFeaturesString = formData.get("imageFeatures") as string;
    // const currentHistoryRaw = JSON.parse(formData.get("chatHistory") as string || '[]');
    // ... rest of the original action logic ...
    // return json<ActionData>({ hint, gameFinished, ... });

  } catch (error) {
    console.error("API Chat Action: Error processing request:", error);
    return json<ActionData>({ error: "Failed to process chat message." }, { status: 500 });
  }
};

// Optional: Add a loader that explicitly denies GET requests if you want
// export const loader = () => {
//   throw new Response("Not Found", { status: 404 });
// };
