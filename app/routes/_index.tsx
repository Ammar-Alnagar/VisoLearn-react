import * as React from "react";
import type { MetaFunction, ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useFetcher, useSubmit, useNavigation } from "@remix-run/react";
import { getImageByDifficulty, type ImageData } from "~/data/images.server";
import { getGeminiHint, generateImageFeatures, generateImage, type ChatEntry } from "~/utils/gemini.server.ts";

export const meta: MetaFunction = () => {
  return [
    { title: "Gemini Image Describer" },
    { name: "description", content: "Describe images with hints from Gemini!" },
  ];
};

// --- Local Storage Keys ---
const STORAGE_KEY_GAME_STATE = "geminiImageDescriberGameState";

// --- Game State Interface ---
interface GameState {
  image: ImageData | null;
  chatHistory: { role: 'user' | 'model', text: string }[];
  correctFeatures: string[];
  gameFinished: boolean;
  gameStarted: boolean;
  attemptsRemaining: number;
  maxAttempts: number;
  winThreshold: number;
  userInput: {
      age: string;
      level: string;
      style: string;
      topic: string;
      attempts: string;
      threshold: string;
  } | null;
}

interface LoaderData {
  image: ImageData | null; // Can be null initially
  chatHistory: { role: 'user' | 'model', text: string }[];
  correctFeatures: string[];
  gameFinished: boolean;
  gameStarted: boolean; // Reflects if the loader *intended* to start a game
  attemptsRemaining: number;
  maxAttempts: number;
  winThreshold: number;
  userInput: GameState['userInput'] | null; // Can be null initially
  error?: string;
}

// --- Loader ---
// Loads initial state OR generates/fetches image based on query params from form submission.
export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const url = new URL(request.url);
  const difficulty = url.searchParams.get("difficulty") as ImageData['difficulty'] | null;
  const age = url.searchParams.get("age") || '';
  const style = url.searchParams.get("style") || 'any';
  const topic = url.searchParams.get("topic") || ''; // Get topic, default empty
  const attemptsStr = url.searchParams.get("attempts") || '10'; // Default attempts
  const thresholdStr = url.searchParams.get("threshold") || '4'; // Default threshold

  const attempts = parseInt(attemptsStr, 10);
  const threshold = parseInt(thresholdStr, 10);

  // --- Only proceed with image generation/fetching if difficulty and topic are present (indicating form submission) ---
  if (difficulty && topic) {
    console.log("Loader: Form submitted, attempting to load/generate image...");
    const imageGenPrompt = `Generate an image suitable for a ${difficulty} description game. The user's age is ${age || 'unspecified'}. The desired style is ${style}. The image should focus on the topic: ${topic}.`;

    let generatedImageData: ImageData | null = null;
    const dynamicImageResult = await generateImage(imageGenPrompt);

    if (dynamicImageResult) {
      const features = await generateImageFeatures(dynamicImageResult.alt);
      generatedImageData = {
        id: Date.now(),
        url: dynamicImageResult.url,
        alt: dynamicImageResult.alt,
        features: features.length > 0 ? features : ["object", "color", "background"], // Fallback features if generation fails
        difficulty: difficulty,
      };
      console.log("Loader: Dynamically generated image data from Gemini:", generatedImageData);
    }

    const image = generatedImageData ?? getImageByDifficulty(difficulty); // Fallback to static if generation failed

    if (!image) {
      return {
        error: "Could not load or generate image.",
        image: null, chatHistory: [], correctFeatures: [], gameFinished: false, gameStarted: false, // Explicitly false
        attemptsRemaining: attempts, maxAttempts: attempts, winThreshold: threshold, userInput: null
      };
    }

    // Generate dynamic features for static image if needed
    if (!generatedImageData && image && image.features.length === 0) { // Only if static image has no features defined
        console.log("Loader: Using static image, attempting to generate features dynamically...");
        const dynamicFeatures = await generateImageFeatures(image.alt);
        if (dynamicFeatures.length > 0) {
            image.features = dynamicFeatures;
            console.log("Loader: Using dynamically generated features for static image:", dynamicFeatures);
        } else {
            image.features = ["item", "setting", "detail"]; // Final fallback
        }
    }

    // Return state for an active game
    console.log("Loader: Returning loader data for active game:", { image: !!image, gameStarted: true });
    return {
      image,
      chatHistory: [], // Client loads history if exists
      correctFeatures: [], // Client loads progress if exists
      gameFinished: false, // Client loads status if exists
      gameStarted: true, // Indicate game should start
      attemptsRemaining: attempts,
      maxAttempts: attempts,
      winThreshold: threshold,
      userInput: { age, level: difficulty, style, topic, attempts: attemptsStr, threshold: thresholdStr },
    };
  } else {
    // --- Initial Load: No form submitted, return default empty state ---
    console.log("Loader: Initial load, returning empty state.");
    return {
      image: null,
      chatHistory: [],
      correctFeatures: [],
      gameFinished: false,
      gameStarted: false, // Explicitly false for initial load
      attemptsRemaining: attempts, // Use defaults
      maxAttempts: attempts,
      winThreshold: threshold,
      userInput: null, // No user input yet
    };
  }
};

// --- Action ---
interface ActionData {
  hint?: string;
  error?: string;
  gameFinished?: boolean;
  correctFeatures?: string[];
  attemptsRemaining?: number; // Include attempts in action response
  isGameOver?: boolean; // Indicate if game ended due to attempts
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const userAttempt = formData.get("userAttempt") as string;
  const imageFeaturesString = formData.get("imageFeatures") as string;
  const currentHistoryRaw = JSON.parse(formData.get("chatHistory") as string || '[]');
  const correctlyGuessed = JSON.parse(formData.get("correctFeatures") as string || '[]');
  const attemptsLeft = parseInt(formData.get("attemptsRemaining") as string || '0', 10);
  const winThreshold = parseInt(formData.get("winThreshold") as string || '4', 10); // Get threshold from form

  if (!userAttempt || !imageFeaturesString || isNaN(attemptsLeft) || isNaN(winThreshold)) {
    return json<ActionData>({ error: "Invalid request data." }, { status: 400 });
  }

  let currentAttemptsRemaining = attemptsLeft - 1; // Decrement attempt *before* processing guess

  const imageFeatures = JSON.parse(imageFeaturesString);

  const currentHistory: ChatEntry[] = currentHistoryRaw.map((msg: any) => ({
    role: msg.role === 'user' ? 'user' : 'model',
    parts: [{ text: msg.text || '' }]
  })).filter((msg: ChatEntry) => msg.parts[0].text);

  let newlyGuessed: string | null = null;
  const remainingFeatures = imageFeatures.filter((f: string) => !correctlyGuessed.includes(f.toLowerCase()));

  for (const feature of remainingFeatures) {
    if (userAttempt.toLowerCase().includes(feature.toLowerCase())) {
      newlyGuessed = feature.toLowerCase();
      break;
    }
  }

  let hint = "";
  let updatedCorrectFeatures = [...correctlyGuessed];
  let gameFinished = false;
  let isGameOver = false;

  if (newlyGuessed) {
    updatedCorrectFeatures.push(newlyGuessed);
    // Check win conditions
    if (updatedCorrectFeatures.length >= winThreshold) {
        hint = `Yes, "${newlyGuessed}" is correct! 🎉 You've reached the win threshold by guessing ${winThreshold} features! Well done!`;
        gameFinished = true;
    } else if (updatedCorrectFeatures.length >= imageFeatures.length) { // Also win if all features guessed (even if below threshold somehow)
        hint = `Yes, "${newlyGuessed}" is correct! 🎉 You've described all the features! Well done!`;
        gameFinished = true;
    } else {
        hint = `Great! You found "${newlyGuessed}". Keep going! What else do you see? (${currentAttemptsRemaining} attempts left)`;
    }
  } else {
    // Incorrect guess
    if (currentAttemptsRemaining <= 0) {
        hint = `Sorry, that wasn't quite right. You're out of attempts! 😥 The remaining features were: ${remainingFeatures.join(', ')}.`;
        gameFinished = true;
        isGameOver = true; // Specifically indicate game over due to attempts
    } else {
        // If no direct match and attempts remain, ask Gemini for a hint
        hint = await getGeminiHint(remainingFeatures, userAttempt, currentHistory);
        hint += ` (${currentAttemptsRemaining} attempts left)`; // Append attempts remaining to hint
    }
  }

  // Ensure gameFinished is true if isGameOver is true
  if (isGameOver) {
      gameFinished = true;
  }

  return json<ActionData>({
      hint,
      gameFinished,
      correctFeatures: updatedCorrectFeatures,
      attemptsRemaining: currentAttemptsRemaining,
      isGameOver
  });
};


// --- Component ---
export default function Index() {
  const initialLoaderData = useLoaderData<LoaderData>();
  const fetcher = useFetcher<ActionData>();
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmittingForm = navigation.state === 'submitting' && navigation.formMethod === 'get'; // Check if submitting the start form
  const isFetchingHint = fetcher.state !== 'idle';

  // --- State Management ---
  const [isClient, setIsClient] = React.useState(false);
  const [gameState, setGameState] = React.useState<GameState>(() => {
      // Initial state should ALWAYS reflect the loader's decision on gameStarted
      const initialState = {
          image: initialLoaderData.image,
          chatHistory: initialLoaderData.chatHistory,
          correctFeatures: initialLoaderData.correctFeatures,
          gameFinished: initialLoaderData.gameFinished,
          gameStarted: initialLoaderData.gameStarted, // CRITICAL: Use loader's gameStarted value
          attemptsRemaining: initialLoaderData.attemptsRemaining,
          maxAttempts: initialLoaderData.maxAttempts,
          winThreshold: initialLoaderData.winThreshold,
          userInput: initialLoaderData.userInput,
      };
      console.log("useState [gameState]: Initial state from loader:", initialState);
      return initialState;
  });

  const { image, chatHistory, correctFeatures, gameFinished, gameStarted, attemptsRemaining, maxAttempts, winThreshold, userInput } = gameState;
  const [currentInput, setCurrentInput] = React.useState("");
  const chatContainerRef = React.useRef<HTMLDivElement>(null);

  // --- Effects ---

  // Effect to sync state with loader data when it changes (e.g., after form submission)
  React.useEffect(() => {
      console.log("useEffect [initialLoaderData]: Loader data changed. Syncing state.", initialLoaderData);
      // Only update if the loader indicates a change in game state or image
      if (initialLoaderData.gameStarted !== gameState.gameStarted || initialLoaderData.image?.id !== gameState.image?.id) {
          setGameState({
              image: initialLoaderData.image,
              chatHistory: [], // Reset history for new game
              correctFeatures: [], // Reset features for new game
              gameFinished: initialLoaderData.gameFinished,
              gameStarted: initialLoaderData.gameStarted,
              attemptsRemaining: initialLoaderData.attemptsRemaining,
              maxAttempts: initialLoaderData.maxAttempts,
              winThreshold: initialLoaderData.winThreshold,
              userInput: initialLoaderData.userInput,
          });
          // Clear local storage only if loader started a *new* game
          if (initialLoaderData.gameStarted && isClient) {
              localStorage.removeItem(STORAGE_KEY_GAME_STATE);
          }
      }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoaderData]); // Rerun when loader data changes


  // Load state from localStorage on client mount (only if loader didn't start a game)
  React.useEffect(() => {
    setIsClient(true);
    // Only try to load from localStorage if the loader *didn't* just start a game
    if (!initialLoaderData.gameStarted) {
        const savedStateRaw = localStorage.getItem(STORAGE_KEY_GAME_STATE);
        if (savedStateRaw) {
            try {
                const savedState = JSON.parse(savedStateRaw) as GameState;
                // Basic validation
                if (savedState.image && savedState.chatHistory && savedState.correctFeatures && savedState.gameStarted) {
                    console.log("useEffect [localStorage]: Restoring game state from localStorage");
                    setGameState(savedState);
                } else {
                    console.log("useEffect [localStorage]: Invalid or non-started game state in localStorage, clearing.");
                    localStorage.removeItem(STORAGE_KEY_GAME_STATE);
                }
            } catch (e) {
                console.error("useEffect [localStorage]: Failed to parse saved game state:", e);
                localStorage.removeItem(STORAGE_KEY_GAME_STATE);
            }
        } else {
             console.log("useEffect [localStorage]: No saved game state found.");
        }
    } else {
        console.log("useEffect [localStorage]: Loader started game, skipping localStorage load.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoaderData.gameStarted]); // Run only once on mount based on initial loader state


  // Save state to localStorage whenever it changes (on client, only if game is active)
  React.useEffect(() => {
    if (isClient && gameStarted && !gameFinished) { // Only save active, unfinished games
      console.log("useEffect [gameState]: Saving active game state to localStorage");
      localStorage.setItem(STORAGE_KEY_GAME_STATE, JSON.stringify(gameState));
    } else if (isClient && gameFinished) {
        // Remove from storage once game is finished to prevent reloading a finished game
        console.log("useEffect [gameState]: Game finished, removing from localStorage");
        localStorage.removeItem(STORAGE_KEY_GAME_STATE);
    }
  }, [gameState, isClient, gameStarted, gameFinished]);

  // Process fetcher data (hints, errors, game state updates)
  React.useEffect(() => {
    if (fetcher.data) {
        console.log("useEffect [fetcher.data]: Processing fetcher response:", fetcher.data);
        const { hint, error, gameFinished: finished, correctFeatures: newFeatures, attemptsRemaining: remaining, isGameOver } = fetcher.data;

        if (hint) {
            setGameState(prev => ({
                ...prev,
                chatHistory: [...prev.chatHistory, { role: 'model', text: hint }],
                correctFeatures: newFeatures ?? prev.correctFeatures,
                gameFinished: finished ?? prev.gameFinished,
                attemptsRemaining: remaining ?? prev.attemptsRemaining, // Update attempts from action
            }));
        } else if (error) {
            setGameState(prev => ({
                ...prev,
                chatHistory: [...prev.chatHistory, { role: 'model', text: `Error: ${error}` }],
                // Don't change attempts/finish status on error
            }));
        }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]);

   // Auto-scroll chat
  React.useEffect(() => {
    chatContainerRef.current?.scrollTo(0, chatContainerRef.current.scrollHeight);
  }, [chatHistory]);

  // --- Event Handlers ---

  const handleStartGame = (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      console.log("handleStartGame called");
      const formData = new FormData(event.currentTarget);

      // Clear previous game state from storage *before* submitting
      if (isClient) {
          localStorage.removeItem(STORAGE_KEY_GAME_STATE);
      }

      // No need to set client state here, loader will handle it.
      // Just submit the form to trigger the loader.
      console.log("handleStartGame: Submitting form to trigger loader...");
      submit(formData, { method: 'get', action: '/' });
  };


  const handleSendMessage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentInput.trim() || !image || fetcher.state !== 'idle' || gameFinished) return;

    const userMessage = currentInput.trim();

    // Update state immediately for user message
    setGameState(prev => ({
        ...prev,
        chatHistory: [...prev.chatHistory, { role: 'user', text: userMessage }],
        // DO NOT decrement attempts here, action handles it
    }));
    setCurrentInput(""); // Clear input field

    // Prepare data for the action
    const formData = new FormData();
    formData.append("userAttempt", userMessage);
    formData.append("imageFeatures", JSON.stringify(image.features));
    formData.append("chatHistory", JSON.stringify(chatHistory)); // Send history *before* adding user message
    formData.append("correctFeatures", JSON.stringify(correctFeatures));
    formData.append("attemptsRemaining", String(attemptsRemaining)); // Send current attempts
    formData.append("winThreshold", String(winThreshold)); // Send win threshold

    fetcher.submit(formData, { method: "post" });
  };

  const handleResetGame = () => {
      console.log("handleResetGame called");
      if (isClient) {
          localStorage.removeItem(STORAGE_KEY_GAME_STATE);
      }
      // Reset state and go back to setup screen by navigating without params
      // This will trigger the loader again, which will return the initial empty state.
      console.log("handleResetGame: Navigating to / to reset...");
      submit(null, { method: 'get', action: '/' });
  };

  // --- Render Logic ---

  console.log("Render: State before conditional render:", { isSubmittingForm, gameStarted, image: !!image, fetcherState: fetcher.state });

  // Determine if we are showing the loading overlay
  const showLoadingOverlay = isSubmittingForm; // Show loading only when the start form is submitting

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans relative"> {/* Added relative positioning */}
      {/* Loading Overlay */}
      {showLoadingOverlay && (
          <div className="absolute inset-0 bg-gray-500 bg-opacity-50 dark:bg-gray-800 dark:bg-opacity-60 flex justify-center items-center z-50">
              <div className="text-white text-xl font-semibold animate-pulse">Generating your game...</div>
          </div>
      )}

      {/* Header */}
      <header className="p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-center">Gemini Image Describer</h1>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden p-2 sm:p-4">
          {initialLoaderData.error && !image ? (
              // Error Display
              <div className="flex justify-center items-center h-full">
                   <div className="p-6 text-red-600 bg-red-100 dark:bg-red-900 dark:text-red-200 rounded max-w-md mx-auto text-center shadow">
                       <h2 className="text-lg font-semibold mb-2">Error</h2>
                       <p>{initialLoaderData.error}</p>
                       <button
                          onClick={handleResetGame}
                          className="mt-4 bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 transition-colors text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800"
                      >
                          Try Again
                      </button>
                   </div>
              </div>
          ) : !gameStarted || !image ? (
              // Setup Screen
              <div className="max-w-lg mx-auto bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                  <h2 className="text-xl font-semibold mb-5 text-center">Start a New Game</h2>
                  {/* Use a standard Form, not fetcher.Form for GET navigation */}
                  <Form onSubmit={handleStartGame} method="get" action="/" className="space-y-4">
                       <div>
                          <label htmlFor="topic" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Topic:</label>
                          <input
                              type="text"
                              id="topic"
                              name="topic"
                              defaultValue={userInput?.topic ?? "a cute animal"}
                              placeholder="e.g., a futuristic city, a cat playing"
                              required
                              className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:ring-blue-500 focus:border-blue-500"
                          />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                              <label htmlFor="level" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Difficulty:</label>
                              <select
                                  id="level"
                                  name="difficulty"
                                  defaultValue={userInput?.level ?? "easy"}
                                  required // Make difficulty required
                                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:ring-blue-500 focus:border-blue-500"
                              >
                                  <option value="easy">Easy</option>
                                  <option value="medium">Medium</option>
                                  <option value="hard">Hard</option>
                              </select>
                          </div>
                          <div>
                              <label htmlFor="style" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Style:</label>
                              <input
                                  type="text"
                                  id="style"
                                  name="style"
                                  defaultValue={userInput?.style ?? "realistic"}
                                  placeholder="e.g., cartoon, abstract"
                                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:ring-blue-500 focus:border-blue-500"
                              />
                          </div>
                          <div>
                              <label htmlFor="age" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Age (Optional):</label>
                              <input
                                  type="number"
                                  id="age"
                                  name="age"
                                  defaultValue={userInput?.age ?? ""}
                                  min="1"
                                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:ring-blue-500 focus:border-blue-500"
                              />
                          </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                              <label htmlFor="attempts" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Attempts:</label>
                              <input
                                  type="number"
                                  id="attempts"
                                  name="attempts"
                                  defaultValue={userInput?.attempts ?? "10"}
                                  min="1"
                                  max="50" // Add a reasonable max
                                  required
                                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:ring-blue-500 focus:border-blue-500"
                              />
                          </div>
                          <div>
                              <label htmlFor="threshold" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Win Threshold (Features):</label>
                              <input
                                  type="number"
                                  id="threshold"
                                  name="threshold"
                                  defaultValue={userInput?.threshold ?? "4"}
                                  min="1"
                                  max="20" // Add a reasonable max
                                  required
                                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:ring-blue-500 focus:border-blue-500"
                              />
                          </div>
                      </div>
                      <button
                          type="submit"
                          disabled={isSubmittingForm} // Disable button while submitting
                          className="w-full bg-blue-600 text-white p-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-wait"
                      >
                          {isSubmittingForm ? 'Starting...' : 'Start Game'}
                      </button>
                  </Form>
              </div>
          ) : (
              // Game Screen
              <div className="flex flex-col lg:flex-row h-full gap-4">
                  {/* Image Panel */}
                   <div className="w-full lg:w-1/2 xl:w-2/5 flex flex-col bg-white dark:bg-gray-800 p-4 rounded-lg shadow overflow-hidden">
                      <h2 className="text-lg font-semibold mb-3 text-center flex-shrink-0">Describe this Image:</h2>
                      <div className="flex-grow flex justify-center items-center min-h-[200px] mb-3 overflow-hidden relative bg-gray-200 dark:bg-gray-700 rounded">
                          {/* Image itself */}
                          <img
                              src={image.url}
                              alt={image.alt || 'Generated image'} // Provide default alt text
                              className={`max-w-full max-h-full object-contain rounded transition-opacity duration-500 ease-in-out ${isSubmittingForm ? 'opacity-0' : 'opacity-100'}`} // Fade in image
                              // Add onLoad handler if needed for smoother transition, but CSS handles basic fade
                          />
                          {/* Placeholder/Spinner while image might be loading (though data URL should be fast) */}
                           {isSubmittingForm && ( // Show spinner only during initial form submission
                              <div className="absolute inset-0 flex justify-center items-center">
                                  <svg className="animate-spin h-8 w-8 text-blue-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                              </div>
                          )}
                      </div>
                      <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 w-full flex-shrink-0 border-t dark:border-gray-700 pt-3 mt-auto space-y-1">
                          <p><b>Difficulty:</b> {image.difficulty}</p>
                          <p><b>Topic:</b> {userInput?.topic || 'N/A'}</p>
                          <p className={`font-medium ${attemptsRemaining <= 3 && attemptsRemaining > 0 ? 'text-orange-500' : attemptsRemaining === 0 ? 'text-red-600' : ''}`}>
                              <b>Attempts Remaining:</b> {attemptsRemaining} / {maxAttempts}
                          </p>
                          <p><b>Win Threshold:</b> {winThreshold} Features</p>
                          <p><b>Features Found ({correctFeatures.length}/{image.features?.length ?? 0}):</b></p>
                          {image.features && image.features.length > 0 ? (
                              <ul className="list-disc pl-5 text-xs">
                                  {image.features.map(feature => (
                                      <li key={feature} className={`transition-colors ${correctFeatures.includes(feature.toLowerCase()) ? 'text-green-600 dark:text-green-400 line-through' : 'text-gray-500 dark:text-gray-400'}`}>
                                          {correctFeatures.includes(feature.toLowerCase()) ? feature : '???'}
                                      </li>
                                  ))}
                              </ul>
                          ) : (
                              <p className="text-xs text-gray-400 italic">No features defined for this image.</p>
                          )}
                      </div>
                      <button
                          onClick={handleResetGame}
                          disabled={isSubmittingForm || isFetchingHint} // Disable if loading new game or hint
                          className="mt-4 w-full bg-gray-500 text-white p-2 rounded-lg hover:bg-gray-600 transition-colors text-sm flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                          New Game / Change Settings
                      </button>
                  </div>

                  {/* Chat Panel */}
                  <div className="w-full lg:w-1/2 xl:w-3/5 flex flex-col bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                      <h2 className="text-lg font-semibold mb-3 flex-shrink-0">Chat with Gemini</h2>
                      {/* Chat History */}
                      <div ref={chatContainerRef} className="flex-1 overflow-y-auto mb-4 p-3 space-y-3 bg-gray-50 dark:bg-gray-700 rounded-md border border-gray-200 dark:border-gray-600 min-h-[150px]"> {/* Added min-height */}
                          {chatHistory.map((msg, index) => (
                              <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`p-2.5 rounded-lg max-w-[85%] w-fit text-sm shadow-sm break-words ${msg.role === 'user' ? 'chat-message-user' : 'chat-message-gemini'}`}> {/* Added break-words */}
                                      {/* Basic markdown rendering for newlines */}
                                      {msg.text.split('\n').map((line, i) => (
                                          <p key={i} className="chat-text" >{line || '\u00A0'}</p> // Render empty lines too
                                      ))}
                                  </div>
                              </div>
                          ))}
                          {fetcher.state === 'submitting' && (
                              <div className="flex justify-start">
                                  <div className="p-2.5 rounded-lg chat-message-gemini text-gray-600 dark:text-gray-400 text-sm italic w-fit shadow-sm">Gemini is thinking...</div>
                              </div>
                          )}
                          {gameFinished && (
                              <div className={`p-3 rounded-lg ${fetcher.data?.isGameOver ? 'bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-100' : 'bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-100'} text-center text-sm font-semibold w-full mt-2 shadow`}>
                                  {fetcher.data?.isGameOver ? 'Game Over!' : 'You Win! 🎉'} Click "New Game" to play again.
                              </div>
                          )}
                      </div>
                      {/* Chat Input Form */}
                      <fetcher.Form onSubmit={handleSendMessage} method="post" className="mt-auto flex-shrink-0">
                          <div className="flex items-center gap-2 border border-gray-300 dark:border-gray-600 rounded-lg p-2 focus-within:ring-2 focus-within:ring-blue-500">
                              <input
                                  type="text"
                                  name="userAttempt"
                                  value={currentInput}
                                  onChange={(e) => setCurrentInput(e.target.value)}
                                  placeholder={gameFinished ? "Game finished! Start a new game." : attemptsRemaining <= 0 ? "Out of attempts!" : "Describe a feature..."}
                                  className="flex-1 p-2 border-none focus:ring-0 bg-transparent dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                                  disabled={fetcher.state !== 'idle' || gameFinished || isSubmittingForm || attemptsRemaining <= 0} // Disable if game over or loading
                                  autoComplete="off"
                              />
                              <button
                                  type="submit"
                                  className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800"
                                  disabled={fetcher.state !== 'idle' || gameFinished || !currentInput.trim() || isSubmittingForm || attemptsRemaining <= 0}
                                  aria-label="Send message"
                              >
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                                      <path d="M3.105 3.105a1.5 1.5 0 012.122-.001L19.43 14.29a1.5 1.5 0 01-1.13 2.576H1.5a1.5 0 01-1.49-1.813L3.105 3.105zM4.879 6.121L1.5 15.43h14.805L4.879 6.12z" />
                                  </svg>
                              </button>
                          </div>
                      </fetcher.Form>
                  </div>
              </div>
          )}
      </main>
    </div>
  );
}
