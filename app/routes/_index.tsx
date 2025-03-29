import * as React from "react";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { Form, useLoaderData, useFetcher, useSubmit, useNavigation } from "@remix-run/react";
import { getImageByDifficulty, type ImageData } from "~/data/images.server";
import { generateImageFeatures, generateImage, type ChatEntry } from "~/utils/gemini.server.ts";

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
  image: ImageData | null;
  chatHistory: { role: 'user' | 'model', text: string }[]; // Although unused by loader now, keep for type consistency?
  correctFeatures: string[]; // Although unused by loader now, keep for type consistency?
  gameFinished: boolean;
  gameStarted: boolean;
  attemptsRemaining: number;
  maxAttempts: number;
  winThreshold: number;
  userInput: GameState['userInput'] | null;
  error?: string;
}

// --- Loader (Logic remains the same, generates image based on params) ---
export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const url = new URL(request.url);
  const difficulty = url.searchParams.get("difficulty") as ImageData['difficulty'] | null;
  const age = url.searchParams.get("age") || '';
  const style = url.searchParams.get("style") || 'any';
  const topic = url.searchParams.get("topic") || '';
  const attemptsStr = url.searchParams.get("attempts") || '10';
  const thresholdStr = url.searchParams.get("threshold") || '4';

  let attempts = parseInt(attemptsStr, 10);
  if (isNaN(attempts) || attempts < 1) attempts = 10;
  let threshold = parseInt(thresholdStr, 10);
  if (isNaN(threshold) || threshold < 1) threshold = 4;

  if (difficulty && topic) {
    console.log("Loader: GET request with difficulty/topic params. Attempting to load/generate image...");
    const imageGenPrompt = `Generate an image suitable for a ${difficulty} description game. The user's age is ${age || 'unspecified'}. The desired style is ${style}. The image should focus on the topic: ${topic}.`;

    let generatedImageData: ImageData | null = null;
    let errorMsg: string | undefined = undefined;
    try {
        const dynamicImageResult = await generateImage(imageGenPrompt);
        if (dynamicImageResult) {
          // Generate a unique ID for the new image session
          const imageId = Date.now();
          const features = await generateImageFeatures(dynamicImageResult.alt);
          generatedImageData = {
            id: imageId, // Use timestamp as ID
            url: dynamicImageResult.url,
            alt: dynamicImageResult.alt,
            features: features.length > 0 ? features : ["object", "color", "background"], // Fallback features
            difficulty: difficulty,
          };
          console.log("Loader: Dynamically generated image data from Gemini:", generatedImageData);
        } else {
            console.warn("Loader: Gemini image generation returned null.");
            // Optionally fall back to static image here if needed
        }
    } catch (error) {
        console.error("Loader: Error during image/feature generation:", error);
        errorMsg = "Failed to generate image or features. Please try different settings.";
        // Optionally fall back to static image here if needed
    }

    // Use generated image if available, otherwise try static fallback
    const image = generatedImageData ?? getImageByDifficulty(difficulty);

    if (!image) {
      console.error("Loader: No image could be generated or fetched as fallback.");
      return {
        error: errorMsg ?? "Could not load or generate image for the specified difficulty.",
        image: null, chatHistory: [], correctFeatures: [], gameFinished: false, gameStarted: false,
        attemptsRemaining: attempts, maxAttempts: attempts, winThreshold: threshold, userInput: null
      };
    }

    // Ensure static images also get features if needed (and potentially an ID if missing)
    if (!generatedImageData && image && (!image.features || image.features.length === 0)) {
        console.log("Loader: Using static image, attempting to generate features dynamically...");
        try {
            const dynamicFeatures = await generateImageFeatures(image.alt);
            if (dynamicFeatures.length > 0) {
                image.features = dynamicFeatures;
                console.log("Loader: Using dynamically generated features for static image:", dynamicFeatures);
            } else {
                image.features = ["item", "setting", "detail"]; // Default fallback
                console.log("Loader: Feature generation for static image failed, using default fallback features.");
            }
        } catch (featureError) {
             console.error("Loader: Error generating features for static image:", featureError);
             image.features = ["item", "setting", "detail"]; // Default fallback
             errorMsg = (errorMsg ? errorMsg + " " : "") + "Could not generate descriptive features.";
        }
    }

    // Assign a unique ID if the image doesn't have one (especially static ones)
    if (!image.id) {
        // Use a combination of difficulty and timestamp for potentially more stable IDs during reloads if needed,
        // but Date.now() ensures uniqueness for dynamic generation. For static, maybe use its original ID or index?
        // For simplicity now, let's ensure *some* ID exists if dynamic generation failed but static was found.
         image.id = generatedImageData ? generatedImageData.id : `static-${difficulty}-${Date.now()}`;
    }


    console.log("Loader: Returning loader data for active game:", { imageId: image.id, gameStarted: true });
    // Return game state based on successful image load/generation
    return {
      image,
      chatHistory: [], // Initial chat history is empty
      correctFeatures: [], // Initial correct features is empty
      gameFinished: false,
      gameStarted: true, // Signal that the game setup is complete
      attemptsRemaining: attempts,
      maxAttempts: attempts,
      winThreshold: threshold,
      userInput: { age, level: difficulty, style, topic, attempts: String(attempts), threshold: String(threshold) },
      error: errorMsg, // Include potential errors
    };
  } else {
    // Initial load without parameters, return setup state
    console.log("Loader: Initial load or revalidation without params, returning empty state.");
    return {
      image: null,
      chatHistory: [],
      correctFeatures: [],
      gameFinished: false,
      gameStarted: false, // Signal that the game needs setup
      attemptsRemaining: attempts, // Default attempts
      maxAttempts: attempts,
      winThreshold: threshold, // Default threshold
      userInput: null,
    };
  }
};


// --- ActionData Interface (for fetcher response) ---
interface ActionData {
  hint?: string;
  error?: string;
  gameFinished?: boolean;
  correctFeatures?: string[];
  attemptsRemaining?: number;
  isGameOver?: boolean;
  message?: string; // For simplified action response
}


// --- Component ---
export default function Index() {
  const initialLoaderData = useLoaderData<LoaderData>();
  const fetcher = useFetcher<ActionData>(); // Fetcher for chat API calls
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmittingStartForm = navigation.state === 'submitting' && navigation.formMethod?.toLowerCase() === 'get';
  const isSubmittingChat = fetcher.state !== 'idle';

  // --- State Management ---
  const [isClient, setIsClient] = React.useState(false);
  const [gameState, setGameState] = React.useState<GameState>(() => {
      // Initialize state based on loader data ONLY if the loader indicates a game has started
      const initialState: GameState = {
          image: initialLoaderData.gameStarted ? initialLoaderData.image : null,
          chatHistory: initialLoaderData.gameStarted ? [] : [], // Start fresh chat history
          correctFeatures: initialLoaderData.gameStarted ? [] : [], // Start fresh correct features
          gameFinished: initialLoaderData.gameStarted ? initialLoaderData.gameFinished : false,
          gameStarted: initialLoaderData.gameStarted,
          attemptsRemaining: initialLoaderData.attemptsRemaining,
          maxAttempts: initialLoaderData.maxAttempts,
          winThreshold: initialLoaderData.winThreshold,
          userInput: initialLoaderData.gameStarted ? initialLoaderData.userInput : null,
      };
      console.log("useState [gameState]: Initial state derived from loader:", initialState);
      return initialState;
  });

  const { image, chatHistory, correctFeatures, gameFinished, gameStarted, attemptsRemaining, maxAttempts, winThreshold, userInput } = gameState;
  const [currentInput, setCurrentInput] = React.useState("");
  const chatContainerRef = React.useRef<HTMLDivElement>(null);

  // Ref to track previous fetcher state to detect completion
  const prevFetcherStateRef = React.useRef(fetcher.state);
  React.useEffect(() => {
      // Update the ref *after* the render cycle where fetcher.state might have changed
      prevFetcherStateRef.current = fetcher.state;
  });


  // --- Effects ---

  // Effect 1: Sync with Loader Data (MODIFIED TO PREVENT IMAGE CHANGE ON CHAT)
  React.useEffect(() => {
      console.log("useEffect [initialLoaderData]: Loader data changed. Analyzing...", {
          loaderData: initialLoaderData,
          currentGameState: { gameStarted: gameState.gameStarted, imageId: gameState.image?.id },
          currentFetcherState: fetcher.state,
          prevFetcherState: prevFetcherStateRef.current
      });

      // Condition 1: Loader indicates a game should start/is active
      const loaderIndicatesGame = initialLoaderData.gameStarted;
      // Condition 2: Loader provides a different image than current state (or state has no image)
      const isDifferentImage = !gameState.image || initialLoaderData.image?.id !== gameState.image?.id;
      // Condition 3: The loader data represents a potential new game start
      const isPotentialNewGameFromLoader = loaderIndicatesGame && isDifferentImage;

      // Condition 4: Check if the fetcher state transitioned from submitting/loading to idle in this cycle
      const fetcherJustCompleted = (prevFetcherStateRef.current === 'submitting' || prevFetcherStateRef.current === 'loading') && fetcher.state === 'idle';

      console.log("useEffect [initialLoaderData]: Calculated flags:", { loaderIndicatesGame, isDifferentImage, isPotentialNewGameFromLoader, fetcherJustCompleted });

      // --- Logic Branch 1: Loader potentially indicates a new game ---
      if (isPotentialNewGameFromLoader) {
          // SUB-BRANCH 1.A: If the fetcher just completed AND a game was already active, IGNORE the loader's new image.
          // This prevents the chat submission revalidation from changing the image.
          if (fetcherJustCompleted && gameState.gameStarted) {
              console.warn("useEffect [initialLoaderData]: Loader re-ran after fetcher completed, but game is active. IGNORING new image data from loader to prevent unwanted change.");
              // Optionally update non-critical things like attempts/threshold if they changed in loader data,
              // but be cautious not to overwrite game progress. Let's just update settings for now.
              setGameState(prev => ({
                  ...prev,
                  attemptsRemaining: initialLoaderData.attemptsRemaining,
                  maxAttempts: initialLoaderData.maxAttempts,
                  winThreshold: initialLoaderData.winThreshold,
                  userInput: initialLoaderData.userInput, // Keep user input consistent with loader params
              }));
          }
          // SUB-BRANCH 1.B: Otherwise, this is a genuine new game start (initial load with params, or reset then start). Reset the state.
          else {
              console.log("useEffect [initialLoaderData]: Loader started a NEW game (or initial load with params). Resetting component state.");
              setGameState({
                  image: initialLoaderData.image,
                  chatHistory: [], // Reset history
                  correctFeatures: [], // Reset features
                  gameFinished: false, // Reset finished status
                  gameStarted: true, // Mark as started
                  attemptsRemaining: initialLoaderData.attemptsRemaining,
                  maxAttempts: initialLoaderData.maxAttempts,
                  winThreshold: initialLoaderData.winThreshold,
                  userInput: initialLoaderData.userInput,
              });
              if (isClient) {
                  console.log("useEffect [initialLoaderData]: Clearing localStorage for new game.");
                  localStorage.removeItem(STORAGE_KEY_GAME_STATE);
              }
          }
      }
      // --- Logic Branch 2: Loader indicates NO game started, but component state thinks one IS active ---
      // This happens after clicking "New Game / Change Settings" which navigates to '/' without params.
      else if (!loaderIndicatesGame && gameState.gameStarted) {
           console.log("useEffect [initialLoaderData]: Loader returned non-started state (e.g., after reset). Resetting component state to setup screen.");
           setGameState(prev => ({
              ...prev,
              image: null,
              chatHistory: [],
              correctFeatures: [],
              gameFinished: false,
              gameStarted: false, // Go back to setup
              userInput: null,
              // Update attempts/threshold to defaults from loader in case they were changed
              attemptsRemaining: initialLoaderData.attemptsRemaining,
              maxAttempts: initialLoaderData.maxAttempts,
              winThreshold: initialLoaderData.winThreshold,
           }));
           if (isClient) {
               console.log("useEffect [initialLoaderData]: Clearing localStorage due to reset.");
               localStorage.removeItem(STORAGE_KEY_GAME_STATE);
           }
      }
      // --- Logic Branch 3: Loader indicates game started, component state agrees, AND image ID is the SAME ---
      // This might happen on refresh or if loader re-runs without changing the image ID.
      // Update non-critical settings just in case.
      else if (loaderIndicatesGame && gameState.gameStarted && !isDifferentImage) {
           console.log("useEffect [initialLoaderData]: Loader re-ran, same image ID. Updating non-critical settings.");
           setGameState(prev => ({
               ...prev,
               attemptsRemaining: initialLoaderData.attemptsRemaining,
               maxAttempts: initialLoaderData.maxAttempts,
               winThreshold: initialLoaderData.winThreshold,
               userInput: initialLoaderData.userInput,
           }));
      }
      // --- Logic Branch 4: Fallback ---
      else {
          console.log("useEffect [initialLoaderData]: No relevant state change detected or handled by other conditions (e.g., initial load to setup screen).");
           // Ensure defaults are set if loading setup screen initially
           if (!gameState.gameStarted && !loaderIndicatesGame) {
                setGameState(prev => ({
                    ...prev,
                    attemptsRemaining: initialLoaderData.attemptsRemaining,
                    maxAttempts: initialLoaderData.maxAttempts,
                    winThreshold: initialLoaderData.winThreshold,
                }));
           }
      }

  // Dependencies: initialLoaderData drives the effect. isClient ensures localStorage access is safe.
  // gameState.gameStarted and gameState.image?.id are needed for the comparison logic.
  // fetcher.state is needed to detect the transition upon completion.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoaderData, isClient, gameState.gameStarted, gameState.image?.id, fetcher.state]);


  // Effect 2: Load state from localStorage (Runs only on initial mount if no game started by loader)
  React.useEffect(() => {
    setIsClient(true);
    // Only try to load from localStorage if the loader didn't already start a game
    if (!initialLoaderData.gameStarted && !gameState.gameStarted) {
        const savedStateRaw = localStorage.getItem(STORAGE_KEY_GAME_STATE);
        if (savedStateRaw) {
            try {
                const savedState = JSON.parse(savedStateRaw) as GameState;
                // Basic validation: ensure essential parts exist and game wasn't finished
                if (savedState.image && savedState.chatHistory && savedState.correctFeatures && savedState.gameStarted && !savedState.gameFinished) {
                    console.log("useEffect [localStorage]: Restoring active game state from localStorage");
                    // Check again if game state hasn't been started by loader in the meantime
                    if (!gameState.gameStarted) {
                       setGameState(savedState);
                    } else {
                       console.log("useEffect [localStorage]: Game was started by loader concurrently, ignoring localStorage.");
                       localStorage.removeItem(STORAGE_KEY_GAME_STATE); // Clean up potentially stale state
                    }
                } else {
                    console.log("useEffect [localStorage]: Invalid, finished, or non-started game state in localStorage, clearing.");
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
        console.log("useEffect [localStorage]: Loader started game or game already started in state, skipping localStorage load.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLoaderData.gameStarted]); // Run only when loader's initial state is known

  // Effect 3: Save state to localStorage
  React.useEffect(() => {
    // Only save if client-side, game is started, and not finished
    if (isClient && gameStarted && !gameFinished) {
      console.log("useEffect [gameState]: Saving active game state to localStorage");
      localStorage.setItem(STORAGE_KEY_GAME_STATE, JSON.stringify(gameState));
    }
    // Clean up localStorage if game finishes or resets
    else if (isClient && (gameFinished || !gameStarted)) {
        if (localStorage.getItem(STORAGE_KEY_GAME_STATE)) {
            console.log("useEffect [gameState]: Game finished or reset, removing from localStorage");
            localStorage.removeItem(STORAGE_KEY_GAME_STATE);
        }
    }
  }, [gameState, isClient, gameStarted, gameFinished]); // Depend on the whole gameState

  // Effect 4: Process fetcher data (from API route response)
  React.useEffect(() => {
    // Only process if fetcher has new data
    if (fetcher.data) {
        console.log("useEffect [fetcher.data]: Processing fetcher response from API route:", fetcher.data);
        // Destructure data returned by api.chat.ts's action
        const { message, hint, error, gameFinished: finished, correctFeatures: newFeatures, attemptsRemaining: remaining } = fetcher.data;

        setGameState(prev => {
            const newHistory = [...prev.chatHistory];
            // Add message/hint/error from the API route's response to chat history
            if (message) newHistory.push({ role: 'model', text: message });
            else if (hint) newHistory.push({ role: 'model', text: hint });
            else if (error) newHistory.push({ role: 'model', text: `Error: ${error}` }); // Display API errors

            // Update game state based on API response (only if values are provided)
            // This assumes the API route will eventually return game state updates
            return {
                ...prev,
                chatHistory: newHistory,
                correctFeatures: newFeatures ?? prev.correctFeatures,
                gameFinished: finished ?? prev.gameFinished,
                attemptsRemaining: remaining ?? prev.attemptsRemaining,
                // Don't modify gameStarted or image here
            };
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]); // Depend only on fetcher.data

   // Effect 5: Auto-scroll chat
  React.useEffect(() => {
    chatContainerRef.current?.scrollTo(0, chatContainerRef.current.scrollHeight);
  }, [chatHistory]); // Depend only on chatHistory

  // --- Event Handlers ---

  const handleStartGame = (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      console.log("handleStartGame called");
      const formData = new FormData(event.currentTarget);
      // Clear any potentially stale game state from localStorage before starting anew
      if (isClient) {
          localStorage.removeItem(STORAGE_KEY_GAME_STATE);
      }
      console.log("handleStartGame: Submitting form via GET to trigger loader with new params...");
      submit(formData, { method: 'get', action: '/' }); // Submit to root loader
  };


  const handleSendMessage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentInput.trim() || !image || isSubmittingChat || gameFinished || attemptsRemaining <= 0) return;

    const userMessage = currentInput.trim();

    // Optimistically update chat history
    setGameState(prev => ({
        ...prev,
        chatHistory: [...prev.chatHistory, { role: 'user', text: userMessage }],
    }));
    setCurrentInput(""); // Clear input field

    // Prepare data for the API route
    const formData = new FormData();
    formData.append("userAttempt", userMessage);
    // --- TODO: Add other necessary game state data once API logic is restored ---
    // formData.append("imageFeatures", JSON.stringify(image.features || []));
    // formData.append("chatHistory", JSON.stringify(gameState.chatHistory)); // Send current history before adding user message? Or after? API needs to handle.
    // formData.append("correctFeatures", JSON.stringify(correctFeatures));
    // formData.append("attemptsRemaining", String(attemptsRemaining));
    // formData.append("winThreshold", String(winThreshold));
    // formData.append("imageId", String(image.id)); // Send image ID for context

    // Submit using the fetcher to the API route
    console.log("handleSendMessage: Submitting fetcher form (POST) to /api/chat...");
    fetcher.submit(formData, { method: "post", action: "/api/chat" });
  };

  const handleResetGame = () => {
      console.log("handleResetGame called");
      // Clear local storage first
      if (isClient) {
          localStorage.removeItem(STORAGE_KEY_GAME_STATE);
      }
      // Reset component state immediately for responsiveness (will be confirmed by loader)
      setGameState(prev => ({
          ...prev,
          gameStarted: false,
          image: null,
          chatHistory: [],
          correctFeatures: [],
          gameFinished: false,
          userInput: null,
          // Keep attempts/threshold settings? Or reset to defaults? Let loader handle defaults.
      }));
      console.log("handleResetGame: Navigating to / (without params) to reset via loader...");
      // Navigate to root without params to trigger loader's setup state
      submit(null, { method: 'get', action: '/' });
  };

  // --- Render Logic ---

  console.log("Render: State before conditional render:", {
      isSubmittingStartForm,
      isSubmittingChat,
      gameStarted: gameState.gameStarted,
      imageId: gameState.image?.id,
      fetcherState: fetcher.state,
      attemptsRemaining,
      loaderError: initialLoaderData.error
  });

  const showLoadingOverlay = isSubmittingStartForm; // Show overlay only during initial game start submission
  const showSetupScreen = !gameState.gameStarted || !gameState.image; // Show setup if game not started or image missing

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans relative">
      {/* Loading overlay for initial game generation */}
      {showLoadingOverlay && (
          <div className="absolute inset-0 bg-gray-500 bg-opacity-50 dark:bg-gray-800 dark:bg-opacity-60 flex justify-center items-center z-50">
              <div className="text-white text-xl font-semibold animate-pulse">Generating your game...</div>
          </div>
      )}

      <header className="p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-center">Gemini Image Describer</h1>
      </header>

      <main className="flex-1 overflow-hidden p-2 sm:p-4">
          {/* Display Loader Error on Setup Screen */}
          {initialLoaderData.error && showSetupScreen ? (
              <div className="flex justify-center items-center h-full">
                   <div className="p-6 text-red-600 bg-red-100 dark:bg-red-900 dark:text-red-200 rounded max-w-md mx-auto text-center shadow">
                       <h2 className="text-lg font-semibold mb-2">Error Starting Game</h2>
                       <p>{initialLoaderData.error}</p>
                       <button
                          onClick={handleResetGame} // Use reset handler
                          className="mt-4 bg-blue-600 text-white p-2 rounded-lg hover:bg-blue-700 transition-colors text-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800"
                      >
                          Try Again
                      </button>
                   </div>
              </div>
          ) : showSetupScreen ? (
              // Setup Screen Form
              <div className="max-w-lg mx-auto bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                  <h2 className="text-xl font-semibold mb-5 text-center">Start a New Game</h2>
                  {/* Form submits via GET to trigger loader */}
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
                                  required
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
                                  // Use default from loader if no user input yet
                                  defaultValue={userInput?.attempts ?? String(initialLoaderData.maxAttempts)}
                                  min="1"
                                  max="50"
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
                                  // Use default from loader if no user input yet
                                  defaultValue={userInput?.threshold ?? String(initialLoaderData.winThreshold)}
                                  min="1"
                                  max="20" // Set a reasonable max
                                  required
                                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:ring-blue-500 focus:border-blue-500"
                              />
                          </div>
                      </div>
                      <button
                          type="submit"
                          disabled={isSubmittingStartForm} // Disable while submitting this form
                          className="w-full bg-blue-600 text-white p-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-wait"
                      >
                          {isSubmittingStartForm ? 'Starting...' : 'Start Game'}
                      </button>
                  </Form>
              </div>
          ) : (
              // Game Screen Layout
              <div className="flex flex-col lg:flex-row h-full gap-4">
                   {/* Left Panel: Image and Game Info */}
                   <div className="w-full lg:w-1/2 xl:w-2/5 flex flex-col bg-white dark:bg-gray-800 p-4 rounded-lg shadow overflow-hidden">
                      <h2 className="text-lg font-semibold mb-3 text-center flex-shrink-0">Describe this Image:</h2>
                      {/* Image Display Area */}
                      <div className="flex-grow flex justify-center items-center min-h-[200px] mb-3 overflow-hidden relative bg-gray-200 dark:bg-gray-700 rounded">
                          {image && (
                              <img
                                  key={image.id} // Use image ID as key to force re-render on change
                                  src={image.url}
                                  alt={image.alt || 'Generated image'}
                                  // Apply fade-in effect, ensure opacity is correct based on loading state
                                  className={`max-w-full max-h-full object-contain rounded transition-opacity duration-500 ease-in-out ${showLoadingOverlay ? 'opacity-0' : 'opacity-100'}`}
                              />
                          )}
                           {/* Spinner specifically for image loading (if needed, though showLoadingOverlay covers initial load) */}
                           {/* Consider adding a spinner here if image loading itself is slow */}
                      </div>
                      {/* Game Info Section */}
                      <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 w-full flex-shrink-0 border-t dark:border-gray-700 pt-3 mt-auto space-y-1">
                          <p><b>Difficulty:</b> {image?.difficulty ?? 'N/A'}</p>
                          <p><b>Topic:</b> {userInput?.topic || 'N/A'}</p>
                          <p className={`font-medium ${attemptsRemaining <= 3 && attemptsRemaining > 0 ? 'text-orange-500' : attemptsRemaining <= 0 ? 'text-red-600 dark:text-red-400' : ''}`}>
                              <b>Attempts Remaining:</b> {attemptsRemaining} / {maxAttempts}
                          </p>
                          <p><b>Win Threshold:</b> {winThreshold} Features</p>
                          <p><b>Features Found ({correctFeatures.length}/{image?.features?.length ?? '?'})</b></p>
                          {/* Feature List */}
                          {image?.features && image.features.length > 0 ? (
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
                          {/* Display loader errors that occurred during generation but didn't prevent game start */}
                          {initialLoaderData.error && !showSetupScreen && (
                              <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">Note: {initialLoaderData.error}</p>
                          )}
                      </div>
                      {/* Reset Button */}
                      <button
                          onClick={handleResetGame}
                          disabled={isSubmittingStartForm || isSubmittingChat} // Disable during any submission
                          className="mt-4 w-full bg-gray-500 text-white p-2 rounded-lg hover:bg-gray-600 transition-colors text-sm flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                          New Game / Change Settings
                      </button>
                  </div>

                  {/* Right Panel: Chat */}
                  <div className="w-full lg:w-1/2 xl:w-3/5 flex flex-col bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                      <h2 className="text-lg font-semibold mb-3 flex-shrink-0">Chat with Gemini</h2>
                      {/* Chat History Area */}
                      <div ref={chatContainerRef} className="flex-1 overflow-y-auto mb-4 p-3 space-y-3 bg-gray-50 dark:bg-gray-700 rounded-md border border-gray-200 dark:border-gray-600 min-h-[150px]">
                          {chatHistory.map((msg, index) => (
                              <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`p-2.5 rounded-lg max-w-[85%] w-fit text-sm shadow-sm break-words ${msg.role === 'user' ? 'chat-message-user' : 'chat-message-gemini'}`}>
                                      {/* Render newlines correctly */}
                                      {msg.text.split('\n').map((line, i) => (
                                          <p key={i} className="chat-text" >{line || '\u00A0'}</p> // Use non-breaking space for empty lines
                                      ))}
                                  </div>
                              </div>
                          ))}
                          {/* Thinking Indicator */}
                          {isSubmittingChat && (
                              <div className="flex justify-start">
                                  <div className="p-2.5 rounded-lg chat-message-gemini text-gray-600 dark:text-gray-400 text-sm italic w-fit shadow-sm">Gemini is thinking...</div>
                              </div>
                          )}
                          {/* Game Finished Message */}
                          {gameFinished && (
                              <div className={`p-3 rounded-lg ${attemptsRemaining <= 0 ? 'bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-100' : 'bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-100'} text-center text-sm font-semibold w-full mt-2 shadow`}>
                                  {attemptsRemaining <= 0 ? 'Game Over!' : 'You Win! 🎉'} Click "New Game" to play again.
                              </div>
                          )}
                      </div>
                      {/* Chat Input Form (uses fetcher to POST to /api/chat) */}
                      <fetcher.Form onSubmit={handleSendMessage} method="post" action="/api/chat" className="mt-auto flex-shrink-0">
                          <div className="flex items-center gap-2 border border-gray-300 dark:border-gray-600 rounded-lg p-2 focus-within:ring-2 focus-within:ring-blue-500">
                              <input
                                  type="text"
                                  name="userAttempt" // Ensure name matches API expectation
                                  value={currentInput}
                                  onChange={(e) => setCurrentInput(e.target.value)}
                                  placeholder={gameFinished ? "Game finished! Start a new game." : attemptsRemaining <= 0 ? "Out of attempts!" : "Describe a feature..."}
                                  className="flex-1 p-2 border-none focus:ring-0 bg-transparent dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                                  // Disable input if chat is submitting, game is finished/over, or initial form is submitting
                                  disabled={isSubmittingChat || gameFinished || isSubmittingStartForm || attemptsRemaining <= 0}
                                  autoComplete="off"
                              />
                              <button
                                  type="submit"
                                  className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800"
                                  // Disable button under same conditions as input, plus if input is empty
                                  disabled={isSubmittingChat || gameFinished || !currentInput.trim() || isSubmittingStartForm || attemptsRemaining <= 0}
                                  aria-label="Send message"
                              >
                                  {/* Send Icon */}
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
