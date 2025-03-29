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
  model: "gemini-1.5-flash", // Model for text generation (hints, descriptions)
});

// Placeholder for potential future image generation model
// const imageModel = genAI.getGenerativeModel({ model: "gemini-pro-vision" }); // Example, adjust if needed

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


// Placeholder for actual Image Generation function
export async function generateImage(prompt: string): Promise<{ url: string; alt: string } | null> {
  console.log(`--- SIMULATING IMAGE GENERATION ---`);
  console.log(`Prompt: ${prompt}`);
  console.log(`Note: Actual image generation requires a specific API call (e.g., Imagen via Vertex AI or a Gemini image model).`);
  // ** ACTUAL IMPLEMENTATION NEEDED HERE **
  // This would involve:
  // 1. Choosing an image generation model/API (e.g., Imagen 2 on Vertex AI).
  // 2. Making an API call with the prompt.
  // 3. Handling the response, which should contain the image URL(s).
  // 4. Returning the URL and potentially using the prompt as alt text.

  // For now, return null to indicate simulation
  return null;

  /* Example using a hypothetical SDK function (replace with actual implementation)
  try {
    // const imageResponse = await imageModel.generateContent([prompt, { // Assuming multimodal input
    //   inlineData: { mimeType: "image/png", data: "..." } // Or just text prompt
    // }]);
    // const imageUrl = imageResponse.response.candidates[0].content.parts[0].uri; // Adjust based on actual API response structure
    // return { url: imageUrl, alt: prompt };
     return null; // Replace with actual call
  } catch (error) {
    console.error("Error generating image:", error);
    return null;
  }
  */
}
