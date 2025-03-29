import * as React from "react";
import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import {
  Form,
  useLoaderData,
  useFetcher,
  useSubmit,
  useNavigation,
} from "@remix-run/react";
import { getImageByDifficulty, type ImageData } from "~/data/images.server";
import {
  generateImageFeatures,
  generateImage,
  type ChatEntry,
} from "~/utils/gemini.server.ts";

export const meta: MetaFunction = () => {
  return [
    { title: "VisoLearn React Version" },
    { name: "description", content: "Describe images with hints from Gemini!" },
  ];
};

// --- Local Storage Keys ---
const STORAGE_KEY_GAME_STATE = "geminiImageDescriberGameState";

// --- Game State Interface ---
interface GameState {
  image: ImageData | null;
  chatHistory: { role: "user" | "model"; text: string }[];
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
  // Data returned when starting a NEW game
  newGameData?: {
    image: ImageData;
    maxAttempts: number;
    winThreshold: number;
    userInput: GameState["userInput"];
  };
  // Data returned for an existing/initial state
  initialStateData?: {
    maxAttempts: number;
    winThreshold: number;
  };
  // Flag indicating if the loader thinks a game is active based on URL params
  // This helps the client decide whether to load from localStorage or start fresh
  loaderIndicatesActiveGame: boolean;
  error?: string;
}

// --- Loader ---
export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  // --- ADDED LOG ---
  console.log(`\n--- LOADER EXECUTING (${new Date().toISOString()}) ---`);
  const url = new URL(request.url);
  console.log(`Loader: Processing request for URL: ${url.pathname}${url.search}`);

  // --- Get common parameters ---
  const attemptsStr = url.searchParams.get("attempts") || "10";
  const thresholdStr = url.searchParams.get("threshold") || "4";
  let attempts = parseInt(attemptsStr, 10);
  if (isNaN(attempts) || attempts < 1) attempts = 10;
  let threshold = parseInt(thresholdStr, 10);
  if (isNaN(threshold) || threshold < 1) threshold = 4;

  // --- Check for parameters indicating a NEW game request ---
  const difficulty = url.searchParams.get("difficulty") as ImageData["difficulty"] | null;
  const topic = url.searchParams.get("topic");
  const age = url.searchParams.get("age") || "";
  const style = url.searchParams.get("style") || "any";
  const imageId = url.searchParams.get("imageId"); // Check if an imageId exists

  // --- Determine if loader thinks a game is active ---
  // A game is considered active by the loader if an imageId is present in the URL.
  // This helps differentiate refreshes/revalidations from new game starts.
  const loaderIndicatesActiveGame = !!imageId;
  console.log(`Loader: Active game indicated by URL? ${loaderIndicatesActiveGame} (imageId: ${imageId})`);

  // --- Scenario 1: Request is for a NEW game (difficulty & topic provided, NO imageId) ---
  if (difficulty && topic && !imageId) {
    console.log("Loader: New game request detected. Generating image...");
    const imageGenPrompt = `Generate an image suitable for a ${difficulty} description game. The user's age is ${
      age || "unspecified"
    }. The desired style is ${style}. The image should focus on the topic: ${topic}.`;

    let generatedImageData: ImageData | null = null;
    let errorMsg: string | undefined = undefined;
    try {
      const dynamicImageResult = await generateImage(imageGenPrompt);
      if (dynamicImageResult) {
        const newImageId = `gen-${Date.now()}`; // Generate a unique ID for the new game session
        const features = await generateImageFeatures(dynamicImageResult.alt);
        generatedImageData = {
          id: newImageId,
          url: dynamicImageResult.url,
          alt: dynamicImageResult.alt,
          features: features.length > 0 ? features : ["object", "color", "background"],
          difficulty: difficulty,
        };
        console.log("Loader: Dynamically generated image data:", generatedImageData);
      } else {
        console.warn("Loader: Gemini image generation returned null.");
        errorMsg = "Failed to generate image from Gemini. Using fallback.";
      }
    } catch (error) {
      console.error("Loader: Error during image/feature generation:", error);
      errorMsg = "Error generating image or features. Using fallback.";
    }

    // Use generated image if available, otherwise try static fallback
    const image = generatedImageData ?? getImageByDifficulty(difficulty);

    if (!image) {
      console.error("Loader: No image could be generated or fetched as fallback.");
      return {
        error: errorMsg ?? "Could not load or generate image for the specified difficulty.",
        loaderIndicatesActiveGame: false, // Failed to start
        initialStateData: { maxAttempts: attempts, winThreshold: threshold },
      };
    }

    // Ensure static images also get features if needed
    if (!generatedImageData && image && (!image.features || image.features.length === 0)) {
      console.log("Loader: Using static image, generating features...");
      try {
        const dynamicFeatures = await generateImageFeatures(image.alt);
        image.features = dynamicFeatures.length > 0 ? dynamicFeatures : ["item", "setting", "detail"];
      } catch (featureError) {
        console.error("Loader: Error generating features for static image:", featureError);
        image.features = ["item", "setting", "detail"];
        errorMsg = (errorMsg ? errorMsg + " " : "") + "Could not generate descriptive features.";
      }
    }

    // Assign a unique ID if the image doesn't have one (especially static ones)
    if (!image.id) {
      image.id = `static-${difficulty}-${Date.now()}`;
    }

    console.log("Loader: Returning NEW game data.");
    return {
      newGameData: {
        image,
        maxAttempts: attempts,
        winThreshold: threshold,
        userInput: { age, level: difficulty, style, topic, attempts: String(attempts), threshold: String(threshold) },
      },
      loaderIndicatesActiveGame: true, // Game is now active
      error: errorMsg,
    };
  }

  // --- Scenario 2: Request is NOT for a new game (no difficulty/topic, or imageId exists) ---
  // This covers initial load, refreshes of active games, or navigation back to setup.
  console.log("Loader: Not a new game request. Returning initial/existing state data.");
  return {
    loaderIndicatesActiveGame: loaderIndicatesActiveGame, // Reflects if URL had imageId
    initialStateData: {
      maxAttempts: attempts,
      winThreshold: threshold,
    },
    // No error message here unless a specific error occurred during this simpler load path
  };
};


// --- ActionData Interface (for fetcher response from /api/chat) ---
interface ActionData {
  message?: string; // Combined hint/response message
  error?: string;
  gameFinished?: boolean;
  correctFeatures?: string[];
  attemptsRemaining?: number;
  isGameOver?: boolean; // Derived from attemptsRemaining <= 0
}

// --- Component ---
export default function Index() {
  const loaderData = useLoaderData<LoaderData>();
  const fetcher = useFetcher<ActionData>(); // Fetcher for chat API calls
  const submit = useSubmit();
  const navigation = useNavigation();
  const isSubmittingStartForm =
    navigation.state === "submitting" &&
    navigation.formMethod?.toLowerCase() === "get" &&
    navigation.formData?.has("topic"); // More specific check for start form
  const isSubmittingChat = fetcher.state !== "idle";

  // --- State Management ---
  const [isClient, setIsClient] = React.useState(false);
  const [gameState, setGameState] = React.useState<GameState>(() => {
    // Initial state is always the setup screen state until hydration/effects run
    const initialState: GameState = {
      image: null,
      chatHistory: [],
      correctFeatures: [],
      gameFinished: false,
      gameStarted: false,
      attemptsRemaining: loaderData.initialStateData?.maxAttempts ?? 10,
      maxAttempts: loaderData.initialStateData?.maxAttempts ?? 10,
      winThreshold: loaderData.initialStateData?.winThreshold ?? 4,
      userInput: null,
    };
    console.log("useState [gameState]: Initializing component state:", initialState);
    return initialState;
  });

  const {
    image,
    chatHistory,
    correctFeatures,
    gameFinished,
    gameStarted,
    attemptsRemaining,
    maxAttempts,
    winThreshold,
    userInput,
  } = gameState;
  const [currentInput, setCurrentInput] = React.useState("");
  const chatContainerRef = React.useRef<HTMLDivElement>(null);

  // --- Effects ---

  // Effect 1: Hydration and Local Storage Loading (Client-side only)
  React.useEffect(() => {
    setIsClient(true);
    console.log("useEffect [isClient]: Component hydrated.");

    // Try loading from localStorage ONLY if the loader didn't just provide new game data
    // AND the loader doesn't indicate an active game via URL (prevent localStorage override on refresh)
    if (!loaderData.newGameData && !loaderData.loaderIndicatesActiveGame) {
      const savedStateRaw = localStorage.getItem(STORAGE_KEY_GAME_STATE);
      if (savedStateRaw) {
        try {
          const savedState = JSON.parse(savedStateRaw) as GameState;
          // Validate saved state
          if (
            savedState.image &&
            savedState.chatHistory &&
            savedState.correctFeatures &&
            savedState.gameStarted &&
            !savedState.gameFinished && // Only restore active games
            savedState.attemptsRemaining > 0 // Only restore if attempts remain
          ) {
            console.log("useEffect [isClient]: Restoring active game state from localStorage.");
            setGameState(savedState);
            // Update URL to reflect the restored game's imageId and settings
            const searchParams = new URLSearchParams(window.location.search);
            searchParams.set("imageId", String(savedState.image.id));
            searchParams.set("attempts", String(savedState.maxAttempts));
            searchParams.set("threshold", String(savedState.winThreshold));
            if (savedState.userInput) {
              searchParams.set("topic", savedState.userInput.topic);
              searchParams.set("difficulty", savedState.userInput.level);
              // Add others if needed (age, style)
            }
            window.history.replaceState(null, "", `?${searchParams.toString()}`);
          } else {
            console.log("useEffect [isClient]: Invalid or finished game state in localStorage, clearing.");
            localStorage.removeItem(STORAGE_KEY_GAME_STATE);
          }
        } catch (e) {
          console.error("useEffect [isClient]: Failed to parse saved game state:", e);
          localStorage.removeItem(STORAGE_KEY_GAME_STATE);
        }
      } else {
        console.log("useEffect [isClient]: No saved game state found in localStorage.");
      }
    } else if (loaderData.newGameData) {
       console.log("useEffect [isClient]: New game data provided by loader, skipping localStorage load.");
       // Clear any potentially stale localStorage if loader provided new game
       localStorage.removeItem(STORAGE_KEY_GAME_STATE);
    } else if (loaderData.loaderIndicatesActiveGame) {
        console.log("useEffect [isClient]: Loader indicates active game via URL, skipping localStorage load (loader/state effects will handle).");
        // Potentially clear localStorage here too if URL should always be the source of truth on refresh
        // localStorage.removeItem(STORAGE_KEY_GAME_STATE);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Runs only once on mount

  // Effect 2: Process New Game Data from Loader
  React.useEffect(() => {
    if (loaderData.newGameData) {
      console.log("useEffect [loaderData.newGameData]: New game data received from loader. Setting up game state.");
      const { image: newImage, maxAttempts: newMax, winThreshold: newThreshold, userInput: newUserInput } = loaderData.newGameData;
      setGameState({
        image: newImage,
        chatHistory: [],
        correctFeatures: [],
        gameFinished: false,
        gameStarted: true,
        attemptsRemaining: newMax,
        maxAttempts: newMax,
        winThreshold: newThreshold,
        userInput: newUserInput,
      });
      // Update URL with the new imageId and settings
      const searchParams = new URLSearchParams();
      searchParams.set("imageId", String(newImage.id));
      searchParams.set("attempts", String(newMax));
      searchParams.set("threshold", String(newThreshold));
      // Persist user input settings in URL for potential refresh/restoration
      searchParams.set("topic", newUserInput.topic);
      searchParams.set("difficulty", newUserInput.level);
      searchParams.set("style", newUserInput.style);
      searchParams.set("age", newUserInput.age);

      window.history.replaceState(null, "", `?${searchParams.toString()}`);

      // Clear localStorage explicitly when a new game starts
      if (isClient) {
        localStorage.removeItem(STORAGE_KEY_GAME_STATE);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderData.newGameData, isClient]); // Depend on newGameData and isClient

  // Effect 3: Handle Loader Updates for Non-New-Game Scenarios (e.g., Reset, Refresh)
  React.useEffect(() => {
    // This effect should NOT run if newGameData was just processed
    if (!loaderData.newGameData) {
      // --- ADDED LOG ---
      console.log("useEffect [loaderData flags]: Running check. Loader indicates active game:", loaderData.loaderIndicatesActiveGame, "Component game started:", gameState.gameStarted);

      // Scenario A: Loader indicates NO active game (e.g., after reset, initial load)
      // AND the component state currently thinks a game IS active. Reset component state.
      if (!loaderData.loaderIndicatesActiveGame && gameState.gameStarted) {
        console.log("useEffect [loaderData flags]: Loader indicates no active game, but component state has one. Resetting component state.");
        setGameState(prev => ({
          ...prev,
          image: null,
          chatHistory: [],
          correctFeatures: [],
          gameFinished: false,
          gameStarted: false,
          userInput: null,
          // Update attempts/threshold to defaults from loader
          attemptsRemaining: loaderData.initialStateData?.maxAttempts ?? 10,
          maxAttempts: loaderData.initialStateData?.maxAttempts ?? 10,
          winThreshold: loaderData.initialStateData?.winThreshold ?? 4,
        }));
        if (isClient) {
          localStorage.removeItem(STORAGE_KEY_GAME_STATE);
        }
      }
      // Scenario B: Loader indicates an active game (e.g., on refresh)
      // AND component state also has an active game (likely restored from previous state or just started)
      // AND the image IDs match. Just update settings like attempts/threshold if they changed in URL.
      else if (loaderData.loaderIndicatesActiveGame && gameState.gameStarted && gameState.image) {
         const urlImageId = isClient ? new URL(window.location.href).searchParams.get("imageId") : null;
         if (urlImageId && String(gameState.image.id) === urlImageId) {
            console.log("useEffect [loaderData flags]: Loader indicates active game, component state matches. Updating settings from loader.");
            setGameState(prev => ({
                ...prev,
                maxAttempts: loaderData.initialStateData?.maxAttempts ?? prev.maxAttempts,
                winThreshold: loaderData.initialStateData?.winThreshold ?? prev.winThreshold,
                // Only update attemptsRemaining if it hasn't been changed by gameplay
                // This logic might need refinement depending on desired refresh behavior
            }));
         } else if (urlImageId) {
             console.warn("useEffect [loaderData flags]: Loader indicates active game, but image ID mismatch between URL and component state. This might happen briefly during state transitions or if URL was manually changed. State likely restored from localStorage or previous render. Ignoring loader settings update for now.");
             // Potentially force a reload or reset here if mismatch is critical and persists
         } else {
             console.log("useEffect [loaderData flags]: Loader indicates active game, but component state has image. URL imageId missing (maybe SSR?). Skipping settings update.");
         }
      }
      // Scenario C: Initial load state (loader indicates no active game, component state has no active game)
      else if (!loaderData.loaderIndicatesActiveGame && !gameState.gameStarted) {
          console.log("useEffect [loaderData flags]: Initial setup screen state confirmed.");
          // Ensure defaults are set
          setGameState(prev => ({
              ...prev,
              maxAttempts: loaderData.initialStateData?.maxAttempts ?? 10,
              winThreshold: loaderData.initialStateData?.winThreshold ?? 4,
          }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderData.loaderIndicatesActiveGame, loaderData.initialStateData, gameState.gameStarted, isClient]); // Depend on loader flags and gameStarted


  // Effect 4: Save state to localStorage
  React.useEffect(() => {
    // Only save if client-side, game is started, and not finished
    if (isClient && gameStarted && !gameFinished && image) {
      console.log("useEffect [gameState]: Saving active game state to localStorage");
      // Save the relevant parts of the state
      const stateToSave: GameState = {
          image: gameState.image,
          chatHistory: gameState.chatHistory,
          correctFeatures: gameState.correctFeatures,
          gameFinished: gameState.gameFinished,
          gameStarted: gameState.gameStarted,
          attemptsRemaining: gameState.attemptsRemaining,
          maxAttempts: gameState.maxAttempts,
          winThreshold: gameState.winThreshold,
          userInput: gameState.userInput,
      };
      localStorage.setItem(STORAGE_KEY_GAME_STATE, JSON.stringify(stateToSave));
    }
    // Clean up localStorage if game finishes or resets
    else if (isClient && (gameFinished || !gameStarted)) {
      if (localStorage.getItem(STORAGE_KEY_GAME_STATE)) {
        console.log("useEffect [gameState]: Game finished or reset, removing from localStorage");
        localStorage.removeItem(STORAGE_KEY_GAME_STATE);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState, isClient]); // Depend on the whole gameState

  // Effect 5: Process fetcher data (from API route response)
  React.useEffect(() => {
    if (fetcher.data && fetcher.state === 'idle') { // Process only when fetcher is done
      console.log("useEffect [fetcher.data]: Processing fetcher response:", fetcher.data);
      const {
        message, // Use the combined message field
        error,
        gameFinished: finished,
        correctFeatures: newFeatures,
        attemptsRemaining: remaining,
      } = fetcher.data;

      setGameState((prev) => {
        // --- ADDED LOG ---
        console.log("useEffect [fetcher.data]: Updating state. Current image ID:", prev.image?.id);

        // Ensure we don't process if game isn't started (edge case)
        if (!prev.gameStarted) {
            console.log("useEffect [fetcher.data]: Game not started, skipping state update.");
            return prev;
        }

        const newHistory = [...prev.chatHistory];
        // Avoid adding duplicate model messages if effect runs multiple times
        const lastMessage = newHistory[newHistory.length - 1];
        const newMessageText = message ? "Gemini: " + message : error ? `Error: ${error}` : null;

        if (newMessageText && (!lastMessage || lastMessage.role !== 'model' || lastMessage.text !== newMessageText)) {
            newHistory.push({ role: "model", text: newMessageText });
        } else if (newMessageText) {
            console.log("useEffect [fetcher.data]: Skipping duplicate model message.");
        }


        // Determine if the game is over based on the response
        const isGameOver = remaining !== undefined && remaining <= 0;
        const isWin = finished && !isGameOver; // Win only if finished and not game over

        const nextState = {
          ...prev,
          chatHistory: newHistory,
          // Only update if the API provided new values
          correctFeatures: newFeatures ?? prev.correctFeatures,
          gameFinished: finished ?? prev.gameFinished,
          attemptsRemaining: remaining ?? prev.attemptsRemaining,
          // Don't modify gameStarted or image here
        };

        // --- ADDED LOG ---
        console.log("useEffect [fetcher.data]: State updated. Next image ID:", nextState.image?.id);
        if (prev.image?.id !== nextState.image?.id) {
            console.error("useEffect [fetcher.data]: !!! IMAGE ID CHANGED UNEXPECTEDLY !!!");
        }

        return nextState;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, fetcher.state]); // Depend on fetcher.data AND fetcher.state

  // Effect 6: Auto-scroll chat
  React.useEffect(() => {
    chatContainerRef.current?.scrollTo(0, chatContainerRef.current.scrollHeight);
  }, [chatHistory]); // Depend only on chatHistory

  // --- Event Handlers ---

  const handleStartGame = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    console.log("handleStartGame: Form submitted.");
    const formData = new FormData(event.currentTarget);
    // Clear localStorage before starting a new game via loader
    if (isClient) {
      console.log("handleStartGame: Clearing localStorage.");
      localStorage.removeItem(STORAGE_KEY_GAME_STATE);
    }
    // Clear component state immediately for better UX, loader will confirm
    setGameState(prev => ({
        ...prev,
        gameStarted: false,
        image: null,
        chatHistory: [],
        correctFeatures: [],
        gameFinished: false,
        userInput: null,
    }));
    console.log("handleStartGame: Submitting form via GET to trigger loader with new game params...");
    // Submit to the loader by navigating with GET parameters
    submit(formData, { method: "get", action: "/" });
  };

  const handleSendMessage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentInput.trim() || !image || isSubmittingChat || gameFinished || attemptsRemaining <= 0) return;

    const userMessage = currentInput.trim();

    // Optimistically update chat history
    setGameState((prev) => ({
      ...prev,
      chatHistory: [...prev.chatHistory, { role: "user", text: userMessage }],
    }));
    setCurrentInput(""); // Clear input field

    // Prepare data for the API route
    const formData = new FormData();
    formData.append("userAttempt", userMessage);
    formData.append("imageFeatures", JSON.stringify(image.features || []));
    // Send only the necessary history for the API context
    const historyForApi = chatHistory.map(entry => ({
        role: entry.role,
        parts: [{ text: entry.text.replace(/^(User:|Gemini:)\s*/, '') }] // Remove prefixes for API
    }));
    // Add the *current* user message to the history sent to the API
    historyForApi.push({ role: 'user', parts: [{ text: userMessage }] });
    formData.append("chatHistory", JSON.stringify(historyForApi));
    formData.append("correctFeatures", JSON.stringify(correctFeatures));
    formData.append("attemptsRemaining", String(attemptsRemaining));
    formData.append("winThreshold", String(winThreshold));
    // No need to send imageId in form data if it's not used by API action

    // Submit using the fetcher to the API route
    console.log("handleSendMessage: Submitting fetcher form (POST) to /api/chat...");
    // The action URL for the fetcher doesn't need the imageId query param
    // *** Ensure unstable_skipClientRevalidation: true is present ***
    fetcher.submit(formData, {
        method: "post",
        action: "/api/chat",
        unstable_skipClientRevalidation: true // Prevent loader re-run
    });
  };

 const handleResetGame = () => {
    console.log("handleResetGame: Resetting game.");
    // Clear local storage first
    if (isClient) {
      localStorage.removeItem(STORAGE_KEY_GAME_STATE);
    }
    // Reset component state immediately
    setGameState(prev => ({
      ...prev,
      gameStarted: false,
      image: null,
      chatHistory: [],
      correctFeatures: [],
      gameFinished: false,
      userInput: null,
      // Reset attempts/threshold to initial defaults (loader will confirm)
      attemptsRemaining: loaderData.initialStateData?.maxAttempts ?? 10,
      maxAttempts: loaderData.initialStateData?.maxAttempts ?? 10,
      winThreshold: loaderData.initialStateData?.winThreshold ?? 4,
    }));
    console.log("handleResetGame: Navigating to setup screen (clearing URL params)...");
    // Navigate to the root path without game parameters to trigger loader for setup screen
    submit(null, { method: "get", action: "/" });
  };


  // --- Render Logic ---

  // console.log("Render: Current state:", { // Reduced logging noise for render
  //   isClient,
  //   gameStarted,
  //   gameFinished,
  //   imageId: image?.id,
  //   attemptsRemaining,
  //   isSubmittingStartForm,
  //   isSubmittingChat,
  //   fetcherState: fetcher.state,
  //   loaderError: loaderData.error,
  //   loaderIndicatesActiveGame: loaderData.loaderIndicatesActiveGame,
  //   hasNewGameData: !!loaderData.newGameData,
  // });

  const showLoadingOverlay = isSubmittingStartForm; // Show overlay only during initial game start submission
  const showSetupScreen = !gameStarted; // Show setup if game not started in component state

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans relative">
      {/* Loading overlay for initial game generation */}
      {showLoadingOverlay && (
        <div className="absolute inset-0 bg-gray-500 bg-opacity-50 dark:bg-gray-800 dark:bg-opacity-60 flex justify-center items-center z-50">
          <div className="text-white text-xl font-semibold animate-pulse">
            Generating your game...
          </div>
        </div>
      )}

      <header className="p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <h1 className="text-xl sm:text-2xl font-semibold text-center">
          VisoLearn
        </h1>
      </header>

      <main className="flex-1 overflow-hidden p-2 sm:p-4">
        {/* Display Loader Error on Setup Screen */}
        {loaderData.error && showSetupScreen ? (
          <div className="flex justify-center items-center h-full">
            <div className="p-6 text-red-600 bg-red-100 dark:bg-red-900 dark:text-red-200 rounded max-w-md mx-auto text-center shadow">
              <h2 className="text-lg font-semibold mb-2">
                Error Starting Game
              </h2>
              <p>{loaderData.error}</p>
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
            <h2 className="text-xl font-semibold mb-5 text-center">
              Start a New Game
            </h2>
            {/* Form submits via GET to trigger loader */}
            <Form
              onSubmit={handleStartGame}
              method="get"
              action="/"
              className="space-y-4"
            >
              <div>
                <label
                  htmlFor="topic"
                  className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                >
                  Topic:
                </label>
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
                  <label
                    htmlFor="level"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Difficulty:
                  </label>
                  <select
                    id="level"
                    name="difficulty" // Name matches loader param
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
                  <label
                    htmlFor="style"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Style:
                  </label>
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
                  <label
                    htmlFor="age"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Age (Optional):
                  </label>
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
                  <label
                    htmlFor="attempts"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Attempts:
                  </label>
                  <input
                    type="number"
                    id="attempts"
                    name="attempts"
                    // Use default from loader if no user input yet
                    defaultValue={String(gameState.maxAttempts)}
                    min="1"
                    max="50"
                    required
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="threshold"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Win Threshold (Features):
                  </label>
                  <input
                    type="number"
                    id="threshold"
                    name="threshold"
                    // Use default from loader if no user input yet
                    defaultValue={String(gameState.winThreshold)}
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
                {isSubmittingStartForm ? "Starting..." : "Start Game"}
              </button>
            </Form>
          </div>
        ) : (
          // Game Screen Layout
          <div className="flex flex-col lg:flex-row h-full gap-4">
            {/* Left Panel: Image and Game Info */}
            <div className="w-full lg:w-1/2 xl:w-2/5 flex flex-col bg-white dark:bg-gray-800 p-4 rounded-lg shadow overflow-hidden">
              <h2 className="text-lg font-semibold mb-3 text-center flex-shrink-0">
                Describe this Image:
              </h2>
              {/* Image Display Area */}
              <div className="flex-grow flex justify-center items-center min-h-[200px] mb-3 overflow-hidden relative bg-gray-200 dark:bg-gray-700 rounded">
                {image ? (
                  <img
                    key={image.id} // Use image ID as key to force re-render on change
                    src={image.url}
                    alt={image.alt || "Generated image"}
                    className={`max-w-full max-h-full object-contain rounded transition-opacity duration-500 ease-in-out opacity-100`} // Assume loaded if image exists
                  />
                ) : (
                   <div className="text-gray-500 dark:text-gray-400">Loading image...</div> // Placeholder if image is somehow null but gameStarted is true
                )}
              </div>
              {/* Game Info Section */}
              <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 w-full flex-shrink-0 border-t dark:border-gray-700 pt-3 mt-auto space-y-1">
                <p>
                  <b>Difficulty:</b> {image?.difficulty ?? "N/A"}
                </p>
                <p>
                  <b>Topic:</b> {userInput?.topic || "N/A"}
                </p>
                <p
                  className={`font-medium ${
                    attemptsRemaining <= 3 && attemptsRemaining > 0
                      ? "text-orange-500"
                      : attemptsRemaining <= 0
                      ? "text-red-600 dark:text-red-400"
                      : ""
                  }`}
                >
                  <b>Attempts Remaining:</b> {attemptsRemaining} / {maxAttempts}
                </p>
                <p>
                  <b>Win Threshold:</b> {winThreshold} Features
                </p>
                <p>
                  <b>
                    Features Found ({correctFeatures.length}/
                    {image?.features?.length ?? "?"})
                  </b>
                </p>
                {/* Feature List */}
                {image?.features && image.features.length > 0 ? (
                  <ul className="list-disc pl-5 text-xs">
                    {image.features.map((feature) => {
                       // Normalize both feature and found features for comparison
                       const lowerFeature = feature.toLowerCase();
                       const found = correctFeatures.some(cf => cf.toLowerCase() === lowerFeature);
                       return (
                          <li
                            key={feature} // Use original feature name as key
                            className={`transition-colors ${
                              found
                                ? "text-green-600 dark:text-green-400 line-through"
                                : "text-gray-500 dark:text-gray-400"
                            }`}
                          >
                            {found ? feature : "???"}
                          </li>
                       );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-400 italic">
                    No features defined for this image.
                  </p>
                )}
                {/* Display loader errors that occurred during generation but didn't prevent game start */}
                {loaderData.error && !showSetupScreen && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                    Note: {loaderData.error}
                  </p>
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
              <h2 className="text-lg font-semibold mb-3 flex-shrink-0">
                Chat with Gemini
              </h2>
              {/* Chat History Area */}
              <div
                ref={chatContainerRef}
                className="flex-1 overflow-y-auto mb-4 p-3 space-y-3 bg-gray-50 dark:bg-gray-700 rounded-md border border-gray-200 dark:border-gray-600 min-h-[150px]"
              >
                {chatHistory.map((msg, index) => (
                  <div
                    key={index}
                    className={`flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`p-2.5 rounded-lg max-w-[85%] w-fit text-sm shadow-sm break-words ${
                        msg.role === "user"
                          ? "chat-message-user bg-blue-500 text-white dark:bg-blue-600" // Example user styling
                          : "chat-message-gemini bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-100" // Example Gemini styling
                      }`}
                    >
                      {/* Render newlines correctly */}
                      {msg.text.split("\n").map((line, i) => (
                        <p key={i} className="chat-text">
                          {line || "\u00A0"}
                        </p> // Use non-breaking space for empty lines
                      ))}
                    </div>
                  </div>
                ))}
                {/* Thinking Indicator */}
                {isSubmittingChat && (
                  <div className="flex justify-start">
                    <div className="p-2.5 rounded-lg bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-400 text-sm italic w-fit shadow-sm">
                      Gemini is thinking...
                    </div>
                  </div>
                )}
                {/* Game Finished Message */}
                {gameFinished && (
                  <div
                    className={`p-3 rounded-lg ${
                      attemptsRemaining <= 0
                        ? "bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-100"
                        : "bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-100"
                    } text-center text-sm font-semibold w-full mt-2 shadow`}
                  >
                    {attemptsRemaining <= 0 ? "Game Over!" : "You Win! 🎉"}{" "}
                    Click "New Game" to play again.
                  </div>
                )}
              </div>
              {/* Chat Input Form (uses fetcher to POST to /api/chat) */}
              <fetcher.Form
                onSubmit={handleSendMessage}
                method="post"
                action="/api/chat" // Action targets the API route
                className="mt-auto flex-shrink-0"
              >
                <div className="flex items-center gap-2 border border-gray-300 dark:border-gray-600 rounded-lg p-2 focus-within:ring-2 focus-within:ring-blue-500">
                  <input
                    type="text"
                    name="userAttempt" // Ensure name matches API expectation
                    value={currentInput}
                    onChange={(e) => setCurrentInput(e.target.value)}
                    placeholder={
                      gameFinished
                        ? "Game finished! Start a new game."
                        : attemptsRemaining <= 0
                        ? "Out of attempts!"
                        : "Describe a feature..."
                    }
                    className="flex-1 p-2 border-none focus:ring-0 bg-transparent dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                    // Disable input if chat is submitting, game is finished/over, or initial form is submitting
                    disabled={
                      isSubmittingChat ||
                      gameFinished ||
                      isSubmittingStartForm ||
                      attemptsRemaining <= 0
                    }
                    autoComplete="off"
                  />
                  <button
                    type="submit"
                    className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800"
                    // Disable button under same conditions as input, plus if input is empty
                    disabled={
                      isSubmittingChat ||
                      gameFinished ||
                      !currentInput.trim() ||
                      isSubmittingStartForm ||
                      attemptsRemaining <= 0
                    }
                    aria-label="Send message"
                  >
                    {/* Send Icon */}
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="w-5 h-5"
                    >
                      <path d="M3.105 3.105a1.5 1.5 0 012.122-.001L19.43 14.29a1.5 1.5 0 01-1.13 2.576H1.5a1.5 0 01-1.49-1.813L3.105 3.105zM4.879 6.121L1.5 15.43h14.805L4.879 6.12z" />
                    </svg>
                  </button>
                </div>
                {/* Display fetcher errors directly */}
                 {fetcher.data?.error && (
                    <p className="text-xs text-red-500 dark:text-red-400 mt-1 text-center">
                        Chat Error: {fetcher.data.error}
                    </p>
                 )}
              </fetcher.Form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
