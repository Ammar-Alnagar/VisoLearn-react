import {
  GoogleGenerativeAI,
  HarmCategory,
  HarmBlockThreshold,
  GenerateContentRequest,
  Content,
  Part,
} from "@google/generative-ai";
import "dotenv/config"; // Make sure to load env variables

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error("GEMINI_API_KEY is not defined in the environment variables");
}

const genAI = new GoogleGenerativeAI(apiKey);

const textModel = genAI.getGenerativeModel({
  model: "gemini-2.0-flash", // Model for text generation (hints, descriptions)
});

// Use Gemini Pro Vision for image generation
const imageModel = genAI.getGenerativeModel({
  model: "gemini-2.0-flash-exp-image-generation",
}); // Updated model name

const generationConfig = {
  temperature: 0.8, // Slightly lower temp for more focused hints/descriptions
  topP: 1,
  topK: 32, // Adjusted TopK
  maxOutputTokens: 256,
};

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  {
    category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
];

// Define the structure for chat history parts expected by the SDK
interface ChatPart {
  text: string;
}
export interface ChatEntry {
  // Exporting for use in the route
  role: "user" | "model"; // Correct roles expected by the SDK
  parts: ChatPart[];
}

// Function to get game hints
export async function getGeminiHint(
  targetFeatures: string[],
  userAttempt: string,
  chatHistory: ChatEntry[]
): Promise<string> {
  try {
    const chat = textModel.startChat({
      generationConfig,
      safetySettings,
      history: chatHistory,
    });

    // Extract the last few user attempts from chat history to avoid repeating hints
    const recentAttempts = chatHistory
      .filter((entry) => entry.role === "user")
      .slice(-3)
      .map((entry) => entry.parts[0].text);

    // Create a more structured prompt for better hints
    const prompt = `
You are an observant and helpful game master for an image description game.

GAME STATE:
- Target Features: ${targetFeatures.join(", ")}
- Current Attempt: "${userAttempt}"
- Recent Attempts: ${recentAttempts.join(", ")}

RESPONSE GUIDELINES:
1. If the attempt EXACTLY matches or CONTAINS a target feature:
   - Confirm with "Yes! '[exact feature]' is correct!"
   - Add "You've found X out of ${targetFeatures.length} features."

2. If the attempt is CLOSE to a target feature:
   - Say "You're close!" and give a specific hint about HOW it's different
   - Example: "You said 'house' - think bigger and more specific!"

3. If the attempt is WRONG but in the right category:
   - Acknowledge the category and redirect
   - Example: "You're looking at the right area (sky), but what's special about it?"

4. If the attempt is COMPLETELY OFF:
   - Gently direct attention to a different area
   - Give a clear, specific hint about location or category
   - Example: "Try looking at the bottom of the image - what do you see there?"

5. If it's a HELP request:
   - Provide a more direct hint about size, color, or location
   - Example: "Look for something blue in the upper right corner"

IMPORTANT:
- Keep responses under 2 sentences
- Never reveal a feature directly
- Don't repeat the same hint
- Focus on one feature at a time
- Be specific about location or characteristics

Analyze the attempt and provide an appropriate response following these guidelines.
`;

    const result = await chat.sendMessage(prompt);
    const response = result.response;
    return response.text
      ? response.text()
      : "Try describing something specific you see in the image!";
  } catch (error) {
    console.error("Error getting Gemini hint:", error);
    if (error instanceof Error && error.message.includes("SAFETY")) {
      return "I can't provide a hint for that due to safety settings. Please try describing something else.";
    }
    return "Sorry, I encountered an error. Please try again with a different description.";
  }
}

// Function to generate image features (simulated for now)
// In a real scenario with dynamic images, you'd pass the generated image (URL or data)
// to a vision model to extract features.
export async function generateImageFeatures(
  imageDescription: string
): Promise<string[]> {
  console.log(`Simulating feature generation for: ${imageDescription}`);
  try {
    const prompt = `
       Based on the description "${imageDescription}", list 5-7 key visual features that someone could guess in an image description game.
       Output *only* a comma-separated list of these features. Example: feature1, feature2, feature3
     `;

    const request: GenerateContentRequest = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        ...generationConfig,
        temperature: 0.5,
        maxOutputTokens: 100,
      }, // More deterministic for feature list
      safetySettings,
    };

    const result = await textModel.generateContent(request);
    const response = result.response;
    const text = response.text();

    if (text) {
      // Basic parsing, assuming comma-separated list
      return text
        .split(",")
        .map((f) => f.trim())
        .filter((f) => f.length > 0);
    } else {
      console.warn("Gemini did not return text for feature generation.");
      return ["object", "color", "background", "texture", "shape"]; // Fallback features
    }
  } catch (error) {
    console.error("Error generating image features with Gemini:", error);
    // Fallback features in case of error
    return ["item", "setting", "detail", "action", "mood"];
  }
}

// Actual Image Generation function using Gemini Pro Vision
export async function generateImage(
  prompt: string
): Promise<{ url: string; alt: string } | null> {
  console.log(`--- GENERATING IMAGE FROM GEMINI ---`);
  console.log(`Prompt: ${prompt}`);

  // Enhanced prompt structure
  const enhancedPrompt = `
Generate an image with the following specific requirements:

SUBJECT: ${prompt}

REQUIREMENTS:
- Create a clear, visually distinct image
- Include 5-7 obvious, describable features
- Ensure features are easily distinguishable
- Make colors and objects clearly defined
- Include interesting background elements
- Add contextual details that can be described

STYLE GUIDELINES:
- Use vibrant, distinct colors
- Create clear boundaries between elements
- Avoid overlapping or ambiguous features
- Maintain good contrast and lighting
- Keep the composition balanced and readable

The image should be suitable for a description game where players need to identify specific visual elements.
`;

  try {
    const request = {
      contents: [{ role: "user", parts: [{ text: enhancedPrompt }] }],
      generationConfig: {
        ...generationConfig,
        temperature: 0.7, // Slightly reduced for more consistent results
        maxOutputTokens: 2048,
        responseModalities: ["TEXT", "IMAGE"],
      },
      safetySettings,
    };

    const result = await imageModel.generateContent(request);
    const response = result.response;

    if (!response || !response.candidates || response.candidates.length === 0) {
      console.error("No candidates returned from Gemini Image Generation API.");
      return null;
    }

    const candidate = response.candidates[0];
    if (
      !candidate.content ||
      !candidate.content.parts ||
      candidate.content.parts.length === 0
    ) {
      console.error(
        "No content parts in the candidate from Gemini Image Generation API."
      );
      return null;
    }

    // Assuming the first candidate and part is the image
    const imagePart = candidate.content.parts[0];

    if (
      !imagePart ||
      !("inlineData" in imagePart) ||
      !imagePart.inlineData?.data
    ) {
      console.error(
        "No inline image data returned from Gemini Image Generation API."
      );
      console.log("Response Parts:", candidate.content.parts); // Log parts for debugging
      return null;
    }

    const base64Image = imagePart.inlineData.data;
    const mimeType = imagePart.inlineData.mimeType || "image/png"; // Default to png if not specified
    const imageUrl = `data:${mimeType};base64,${base64Image}`;

    return { url: imageUrl, alt: prompt }; // Use data URL and prompt as alt text
  } catch (error: any) {
    // Explicitly type error as any for accessing message
    console.error("Error generating image with Gemini:", error);
    if (error instanceof Error) {
      console.error("Error details:", error.message); // Log error message for more details
    }
    return null;
  }
}
