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
const imageModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp-image-generation" }); // Updated model name

const generationConfig = {
  temperature: 0.8, // Slightly lower temp for more focused hints/descriptions
  topP: 1,
  topK: 32, // Adjusted TopK
  maxOutputTokens: 256,
};

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

// Define the structure for chat history parts expected by the SDK
interface ChatPart {
    text: string;
}
export interface ChatEntry { // Exporting for use in the route
    role: 'user' | 'model'; // Correct roles expected by the SDK
    parts: ChatPart[];
}

// Function to get game hints
export async function getGeminiHint(
  targetFeatures: string[],
  userAttempt: string,
  chatHistory: ChatEntry[] // Use the defined interface
): Promise<string> {
  try {
    const chat = textModel.startChat({
      generationConfig,
      safetySettings,
      history: chatHistory,
    });

    const prompt = `
      You are a helpful game master for an image description game.
      The key features the user is trying to guess are: ${targetFeatures.join(", ")}.
      The user's latest attempt is: "${userAttempt}".

      Analyze the attempt:
      - If it correctly identifies a remaining feature, say something like "Yes, '[feature]' is correct! What else?"
      - If incorrect, provide a gentle, encouraging hint towards ONE of the remaining features. Don't reveal the feature. Example: "Good try! Maybe look closer at the [general area or type of object related to a feature]."
      - If the user asks for help, give a slightly more direct hint about one feature.
      - Keep responses concise and encouraging. Avoid listing all features.
    `;

    const result = await chat.sendMessage(prompt);
    const response = result.response;
    return response.text ? response.text() : "I'm not sure how to respond to that. Try describing something else!";
  } catch (error) {
    console.error("Error getting Gemini hint:", error);
    if (error instanceof Error && error.message.includes('SAFETY')) {
         return "I can't provide a hint for that due to safety settings. Please try describing a different aspect.";
    }
    return "Sorry, I encountered an error processing that hint. Please try again.";
  }
}

// Function to generate image features (simulated for now)
// In a real scenario with dynamic images, you'd pass the generated image (URL or data)
// to a vision model to extract features.
export async function generateImageFeatures(imageDescription: string): Promise<string[]> {
   console.log(`Simulating feature generation for: ${imageDescription}`);
   try {
     const prompt = `
       Based on the description "${imageDescription}", list 5-7 key visual features that someone could guess in an image description game.
       Output *only* a comma-separated list of these features. Example: feature1, feature2, feature3
     `;

     const request: GenerateContentRequest = {
       contents: [{ role: "user", parts: [{ text: prompt }] }],
       generationConfig: { ...generationConfig, temperature: 0.5, maxOutputTokens: 100 }, // More deterministic for feature list
       safetySettings,
     };

     const result = await textModel.generateContent(request);
     const response = result.response;
     const text = response.text();

     if (text) {
       // Basic parsing, assuming comma-separated list
       return text.split(',').map(f => f.trim()).filter(f => f.length > 0);
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
export async function generateImage(prompt: string): Promise<{ url: string; alt: string } | null> {
  console.log(`--- GENERATING IMAGE FROM GEMINI ---`);
  console.log(`Prompt: ${prompt}`);

  try {
    const request = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        ...generationConfig,
        maxOutputTokens: 2048, // Increased for image generation context
        responseModalities: ['TEXT', 'IMAGE'] // Ensure image modality is requested
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
    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      console.error("No content parts in the candidate from Gemini Image Generation API.");
      return null;
    }


    // Assuming the first candidate and part is the image
    const imagePart = candidate.content.parts[0];


    if (!imagePart || !('inlineData' in imagePart) || !imagePart.inlineData?.data) {
      console.error("No inline image data returned from Gemini Image Generation API.");
      console.log("Response Parts:", candidate.content.parts); // Log parts for debugging
      return null;
    }

    const base64Image = imagePart.inlineData.data;
    const mimeType = imagePart.inlineData.mimeType || 'image/png'; // Default to png if not specified
    const imageUrl = `data:${mimeType};base64,${base64Image}`;

    return { url: imageUrl, alt: prompt }; // Use data URL and prompt as alt text

  } catch (error: any) { // Explicitly type error as any for accessing message
    console.error("Error generating image with Gemini:", error);
    if (error instanceof Error) {
      console.error("Error details:", error.message); // Log error message for more details
    }
    return null;
  }
}
