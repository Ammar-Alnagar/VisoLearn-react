import * as React from "react";
import type { MetaFunction, ActionFunctionArgs, LoaderFunctionArgs } from "@remix-run/node";
import { json, redirect } from "@remix-run/node";
import { Form, useLoaderData, useFetcher, useSubmit, useNavigation } from "@remix-run/react";
import { getImageByDifficulty, type ImageData } from "~/data/images.server";
import { getGeminiHint, generateImageFeatures, generateImage, type ChatEntry } from "~/utils/gemini.server.ts"; // Import new functions

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
  attemptsRemaining: number; // New: Attempts remaining
  maxAttempts: number;      // New: Maximum attempts allowed
  winThreshold: number;     // New: Threshold of features to guess to win
  // User inputs stored to repopulate form
  userInput: {
      age: string;
      level: string;
      style: string;
      topic: string;
      attempts: string; // Input value as string
      threshold: string; // Input value as string
  } | null;
}

interface LoaderData extends GameState {
  error?: string;
  // Include initial user inputs if loaded from storage
  initialUserInput?: GameState['userInput'];
}

// --- Loader ---
// Loads initial state, potentially from localStorage via a client-side effect later,
// or generates a new image/fetches static based on query params.
export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoaderData> => {
  const url = new URL(request.url);
  const difficulty = (url.searchParams.get("difficulty") as ImageData['difficulty']) || 'easy';
  const age = url.searchParams.get("age") || '';
  const style = url.searchParams.get("style") || 'any';
  const topic = url.searchParams.get("topic") || 'any subject'; // Get topic
  const attempts = url.searchParams.get("attempts") || '10'; // Default attempts
  const threshold = url.searchParams.get("threshold") || '4'; // Default threshold

  // Construct a prompt for potential image generation
  const imageGenPrompt = `Generate an image suitable for a ${difficulty} description game. The user's age is ${age || 'unspecified'}. The desired style is ${style}. The image should focus on the topic: ${topic}.`;

  // --- Attempt Dynamic Image Generation (Real Gemini API) ---
  let generatedImageData: ImageData | null = null;
  const dynamicImageResult = await generateImage(imageGenPrompt);

  if (dynamicImageResult) {
      // If generation succeeded:
      // 1. Get features for the generated image
      const features = await generateImageFeatures(dynamicImageResult.alt); // Use alt text (prompt) for description
      generatedImageData = {
          id: Date.now(), // Use timestamp as temporary ID
          url: dynamicImageResult.url,
          alt: dynamicImageResult.alt,
          features: features,
          difficulty: difficulty,
      };
      console.log("Loader: Dynamically generated image data from Gemini:", generatedImageData);
  }
  // --- End Real Gemini Image Generation ---

  // Fallback to static image if generation failed
  const image = generatedImageData ?? getImageByDifficulty(difficulty);

  if (!image) {
    return {
        error: "Could not load or generate image.",
        image: null, chatHistory: [], correctFeatures: [], gameFinished: false, gameStarted: false,
        attemptsRemaining: parseInt(attempts, 10), maxAttempts: parseInt(attempts, 10), winThreshold: parseInt(threshold, 10), userInput: null
    };
  }

  // If dynamic generation was skipped but we *wanted* dynamic features, generate them based on static image alt text
  if (!generatedImageData && image) {
      console.log("Loader: Using static image, attempting to generate features dynamically...");
      const dynamicFeatures = await generateImageFeatures(image.alt);
      if (dynamicFeatures.length > 0) {
          image.features = dynamicFeatures; // Overwrite static features with dynamic ones
          console.log("Loader: Using dynamically generated features for static image:", dynamicFeatures);
      }
  }


  // Return minimal state for server render; client will load full state from localStorage
  console.log("Loader: Returning loader data:", { image: !!image, gameStarted: false }); // Log before return
  return {
      image,
      chatHistory: [], // Client loads history
      correctFeatures: [], // Client loads progress
      gameFinished: false, // Client loads status
      gameStarted: false, // Client determines if game was in progress
      attemptsRemaining: parseInt(attempts, 10), // Initialize attempts
      maxAttempts: parseInt(attempts, 10),      // Store max attempts
      winThreshold: parseInt(threshold, 10),     // Store win threshold
      userInput: { age, level: difficulty, style, topic, attempts, threshold }, // Pass all user inputs back
      initialUserInput: { age, level: difficulty, style, topic, attempts, threshold } // Store initial inputs for client
  };
};

// --- Action ---
interface ActionData {
  hint?: string;
  error?: string;
  gameFinished?: boolean;
  correctFeatures?: string[];
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const userAttempt = formData.get("userAttempt") as string;
  const imageFeaturesString = formData.get("imageFeatures") as string; // Get features from client
  const currentHistoryRaw = JSON.parse(formData.get("chatHistory") as string || '[]');
  const correctlyGuessed = JSON.parse(formData.get("correctFeatures") as string || '[]');

  if (!userAttempt || !imageFeaturesString) {
    return json<ActionData>({ error: "Invalid request data." }, { status: 400 });
  }

  const imageFeatures = JSON.parse(imageFeaturesString);

  // Validate and format history for the Gemini utility
   const currentHistory: ChatEntry[] = currentHistoryRaw.map((msg: any) => ({
     role: msg.role === 'user' ? 'user' : 'model',
     parts: [{ text: msg.text || '' }]
   })).filter((msg: ChatEntry) => msg.parts[0].text);

  // Simple check: see if user attempt matches any remaining feature
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

  if (newlyGuessed) {
      updatedCorrectFeatures.push(newlyGuessed);
      if (updatedCorrectFeatures.length >= imageFeatures.length) { //Win if guessed all
          hint = `Yes, "${newlyGuessed}" is correct! 🎉 You've described all the features! Well done!`;
          gameFinished = true;
      } else if (updatedCorrectFeatures.length >= gameState.winThreshold) { //Win if guessed enough to reach threshold
          hint = `Yes, "${newlyGuessed}" is correct! 🎉 You've reached the win threshold by guessing ${gameState.winThreshold} features! Well done!`;
          gameFinished = true;
      }
       else {
           hint = `Great! You found "${newlyGuessed}". Keep going! What else do you see?`;
      }
  } else {
      // If no direct match, ask Gemini for a hint
      hint = await getGeminiHint(remainingFeatures, userAttempt, currentHistory);
  }

  return json<ActionData>({ hint, gameFinished, correctFeatures: updatedCorrectFeatures });
};


// --- Component ---
export default function Index() {
  // Load initial data from server, but prefer client-side state once loaded
  const initialLoaderData = useLoaderData<LoaderData>();
  const fetcher = useFetcher<ActionData>();
  const submit = useSubmit();
  const navigation = useNavigation(); // To check for GET navigation (game start)
  const isLoading = navigation.state === 'loading' && navigation.location.pathname === '/';


  // --- State Management ---
  const [isClient, setIsClient] = React.useState(false); // Track if running on client
  const [gameState, setGameState] = React.useState<GameState>(() => {
      const initialState = {
          // Initialize with server data, client will override if localStorage exists
          image: initialLoaderData.image,
          chatHistory: initialLoaderData.chatHistory,
          correctFeatures: initialLoaderData.correctFeatures,
          gameFinished: initialLoaderData.gameFinished,
          gameStarted: initialLoaderData.gameStarted,
          attemptsRemaining: initialLoaderData.attemptsRemaining ?? 10, // Default attempts if not in loaderData
          maxAttempts: initialLoaderData.maxAttempts ?? 10,
          winThreshold: initialLoaderData.winThreshold ?? 4,
          userInput: initialLoaderData.initialUserInput ?? null, // Use initial inputs from loader
      };
      console.log("useState [gameState]: Initial state:", initialState); // Log initial state
      return initialState;
  });

  const { image, chatHistory, correctFeatures, gameFinished, gameStarted, attemptsRemaining, maxAttempts, winThreshold, userInput } = gameState;
  const [currentInput, setCurrentInput] = React.useState(""); // User's current message input

  const chatContainerRef = React.useRef<HTMLDivElement>(null);

  // --- Effects ---

  // Load state from localStorage on client mount
  React.useEffect(() => {
    setIsClient(true); // Now we are on the client
    const savedStateRaw = localStorage.getItem(STORAGE_KEY_GAME_STATE);
    if (savedStateRaw) {
      try {
        const savedState = JSON.parse(savedStateRaw) as GameState;
        // Basic validation: check if essential parts exist
        if (savedState.image && savedState.chatHistory && savedState.correctFeatures) {
           // Only restore if the image ID matches the one potentially loaded by server
           // Or if the server didn't load one (e.g., initial load before form submission)
           if (!initialLoaderData.image || savedState.image.id === initialLoaderData.image?.id) {
                console.log("useEffect [localStorage]: Restoring game state from localStorage");
                setGameState(savedState);
           } else {
               console.log("useEffect [localStorage]: Image ID mismatch, clearing stale localStorage state.");
               localStorage.removeItem(STORAGE_KEY_GAME_STATE);
               // Keep initial server loaded image/state
               setGameState(prev => ({
                   ...prev,
                   image: initialLoaderData.image,
                   userInput: initialLoaderData.initialUserInput ?? null,
                   chatHistory: [], correctFeatures: [], gameFinished: false, gameStarted: false,
                   attemptsRemaining: initialLoaderData.attemptsRemaining ?? 10, // Reset to loader defaults
                   maxAttempts: initialLoaderData.maxAttempts ?? 10,
                   winThreshold: initialLoaderData.winThreshold ?? 4,
               }));
           }
        } else {
            localStorage.removeItem(STORAGE_KEY_GAME_STATE); // Clear invalid state
        }
      } catch (e) {
        console.error("useEffect [localStorage]: Failed to parse saved game state:", e);
        localStorage.removeItem(STORAGE_KEY_GAME_STATE);
      }
    } else if (initialLoaderData.image) {
        // If no saved state, but loader provided an image and inputs, ensure they are set
        setGameState(prev => ({
            ...prev,
            image: initialLoaderData.image,
            userInput: initialLoaderData.initialUserInput ?? null,
            attemptsRemaining: initialLoaderData.attemptsRemaining ?? 10, // Set from loader defaults
            maxAttempts: initialLoaderData.maxAttempts ?? 10,
            winThreshold: initialLoaderData.winThreshold ?? 4,
        }));
    }
    console.log("useEffect [localStorage]: after setGameState - gameStarted:", gameState.gameStarted, "image:", !!gameState.image);
  }, [initialLoaderData.image, initialLoaderData.initialUserInput, initialLoaderData.attemptsRemaining, initialLoaderData.winThreshold, initialLoaderData.maxAttempts, gameState.gameStarted, gameState.image]); // Added gameState dependencies for logging

  // Save state to localStorage whenever it changes (on client)
  React.useEffect(() => {
    if (isClient && gameStarted) { // Only save if game is active
      console.log("useEffect [gameState]: Saving game state to localStorage");
      localStorage.setItem(STORAGE_KEY_GAME_STATE, JSON.stringify(gameState));
    }
  }, [gameState, isClient, gameStarted]);

  // Process fetcher data (hints, errors, game state updates)
  React.useEffect(() => {
    if (fetcher.data?.hint) {
      setGameState(prev => ({
          ...prev,
          chatHistory: [...prev.chatHistory, { role: 'model', text: fetcher.data!.hint! }],
          correctFeatures: fetcher.data!.correctFeatures ?? prev.correctFeatures,
          gameFinished: fetcher.data!.gameFinished ?? prev.gameFinished,
      }));
    }
    if (fetcher.data?.error) {
       setGameState(prev => ({
           ...prev,
           chatHistory: [...prev.chatHistory, { role: 'model', text: `Error: ${fetcher.data!.error}` }],
       }));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data]); // Dependency array includes fetcher.data

   // Auto-scroll chat
  React.useEffect(() => {
    chatContainerRef.current?.scrollTo(0, chatContainerRef.current.scrollHeight);
  }, [chatHistory]);

  // --- Event Handlers ---

  const handleStartGame = async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      console.log("handleStartGame called"); // Debug log
      const formData = new FormData(event.currentTarget);
      const difficulty = formData.get("difficulty") as string;
      const age = formData.get("age") as string;
      const style = formData.get("style") as string;
      const topic = formData.get("topic") as string; // Get topic
      const attempts = formData.get("attempts") as string; // Get attempts
      const threshold = formData.get("threshold") as string; // Get threshold


      console.log("Form Data:", { difficulty, age, style, topic, attempts, threshold }); // Debug log

      // Clear previous game state from storage *before* submitting
      if (isClient) {
          localStorage.removeItem(STORAGE_KEY_GAME_STATE);
      }

      // Reset client state immediately for faster UI update
      setGameState((prevState) => {
          console.log("handleStartGame: setGameState callback - prevState gameStarted:", prevState.gameStarted, "image:", !!prevState.image);
          const newState = {
              image: null, // Will be loaded by loader
              chatHistory: [],
              correctFeatures: [],
              gameFinished: false,
              gameStarted: true, // Set game as started
              attemptsRemaining: parseInt(attempts || '10', 10), // Use parsed attempts, default to 10 if empty
              maxAttempts: parseInt(attempts || '10', 10),
              winThreshold: parseInt(threshold || '4', 10),     // Use parsed threshold, default to 4 if empty
              userInput: { age, level: difficulty, style, topic, attempts, threshold } // Store current inputs
          };
          console.log("handleStartGame: setGameState callback - newState:", newState); // Log new state
          return newState;
      });
      setCurrentInput(""); // Clear chat input

      // Log state after startGame handler
      console.log("handleStartGame: State after setGameState:", { gameStarted: gameState.gameStarted, image: !!gameState.image });

      // Use submit to trigger loader with new parameters
      submit(formData, { method: 'get', action: '/' });
  };


  const handleSendMessage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!currentInput.trim() || !image || fetcher.state !== 'idle' || gameFinished) return;

    const userMessage = currentInput.trim();

    // Update state immediately for better UX
    setGameState(prev => ({
        ...prev,
        chatHistory: [...prev.chatHistory, { role: 'user', text: userMessage }],
    }));
    setCurrentInput(""); // Clear input field

    // Prepare data for the action
    const formData = new FormData();
    formData.append("userAttempt", userMessage);
    // Send current image features and history to the action
    formData.append("imageFeatures", JSON.stringify(image.features));
    formData.append("chatHistory", JSON.stringify(chatHistory)); // Send history *before* adding user message
    formData.append("correctFeatures", JSON.stringify(correctFeatures));

    fetcher.submit(formData, { method: "post" });
  };

  const handleResetGame = () => {
      if (isClient) {
          localStorage.removeItem(STORAGE_KEY_GAME_STATE);
      }
      // Reset state and go back to setup screen
      setGameState({
          image: null, chatHistory: [], correctFeatures: [], gameFinished: false, gameStarted: false,
          attemptsRemaining: maxAttempts, maxAttempts: maxAttempts, winThreshold: winThreshold, userInput: null //reset attempts and threshold to max values
      });
      setCurrentInput("");
      // Optional: redirect to clear query params, though just resetting state might be enough
      // submit(null, { method: 'get', action: '/' });
  };

  // --- Render Logic ---

  // Log state before rendering
  console.log("Render: State before conditional render:", { isLoading, gameStarted, image: !!image, initialLoaderDataImage: !!initialLoaderData.image });


  if (initialLoaderData.error && !image) {
    return <div className="p-6 text-red-600 bg-red-100 rounded max-w-md mx-auto">Error loading game data: {initialLoaderData.error}</div>;
  }

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans">
      {/* Header */}
      <header className="p-4 border-b border-gray-200 dark:border-gray-700">
          <h1 className="text-xl sm:text-2xl font-semibold text-center">Gemini Image Describer</h1>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 overflow-hidden p-2 sm:p-4">
          {isLoading ? (
              <div className="flex justify-center items-center h-full">
                  <p className="text-lg animate-pulse">Loading Game...</p>
              </div>
          ) : !gameStarted || !image ? (
              // Setup Screen
              <div className="max-w-lg mx-auto bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
                  <h2 className="text-xl font-semibold mb-5 text-center">Start a New Game</h2>
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
                                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:ring-blue-500 focus:border-blue-500"
                              />
                          </div>
                          <div>
                              <label htmlFor="threshold" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Win Threshold:</label>
                              <input
                                  type="number"
                                  id="threshold"
                                  name="threshold"
                                  defaultValue={userInput?.threshold ?? "4"}
                                  min="1"
                                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:ring-blue-500 focus:border-blue-500"
                              />
                          </div>
                      </div>
                      <button
                          type="submit"
                          className="w-full bg-blue-600 text-white p-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800"
                      >
                          Start Game
                      </button>
                  </Form>
              </div>
          ) : (
              // Game Screen (Improved Layout)
              <div className="flex flex-col lg:flex-row h-full gap-4">
                  {/* Image Panel */}
                  <div className="w-full lg:w-1/2 xl:w-2/5 flex flex-col bg-white dark:bg-gray-800 p-4 rounded-lg shadow overflow-hidden">
                      <h2 className="text-lg font-semibold mb-3 text-center flex-shrink-0">Describe this Image:</h2>
                      <div className="flex-grow flex justify-center items-center min-h-[200px] mb-3 overflow-hidden">
                          {isLoading ? (
                              <div className="flex justify-center items-center">
                                  <div className="typing-indicator">
                                      <span className="typing-dot"></span>
                                      <span className="typing-dot"></span>
                                      <span className="typing-dot"></span>
                                  </div>
                              </div>
                          ) : (
                              <img src={image.url} alt={image.alt} className="max-w-full max-h-full object-contain rounded" />
                          )}
                      </div>
                      <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 w-full flex-shrink-0 border-t dark:border-gray-700 pt-3 mt-auto space-y-1">
                          <p><b>Difficulty:</b> {image.difficulty}</p>
                          <p><b>Topic:</b> {userInput?.topic || 'N/A'}</p>
                          <p><b>Attempts Remaining:</b> {attemptsRemaining} / {maxAttempts}</p> {/* Display attempts */}
                          <p><b>Win Threshold:</b> {winThreshold} Features</p> {/* Display win threshold */}
                          <p><b>Features Found ({correctFeatures.length}/{image.features.length}):</b></p>
                          <ul className="list-disc pl-5 text-xs">
                              {image.features.map(feature => (
                                  <li key={feature} className={`transition-colors ${correctFeatures.includes(feature.toLowerCase()) ? 'text-green-600 dark:text-green-400 line-through' : 'text-gray-500 dark:text-gray-400'}`}>
                                      {correctFeatures.includes(feature.toLowerCase()) ? feature : '???'}
                                  </li>
                              ))}
                          </ul>
                      </div>
                      <button
                          onClick={handleResetGame}
                          className="mt-4 w-full bg-gray-500 text-white p-2 rounded-lg hover:bg-gray-600 transition-colors text-sm flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 dark:focus:ring-offset-gray-800"
                      >
                          New Game / Change Settings
                      </button>
                  </div>

                  {/* Chat Panel */}
                  <div className="w-full lg:w-1/2 xl:w-3/5 flex flex-col bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
                      <h2 className="text-lg font-semibold mb-3 flex-shrink-0">Chat with Gemini</h2>
                      {/* Chat History */}
                      <div ref={chatContainerRef} className="flex-1 overflow-y-auto mb-4 p-3 space-y-3 bg-gray-50 dark:bg-gray-700 rounded-md border border-gray-200 dark:border-gray-600">
                          {chatHistory.map((msg, index) => (
                              <div key={index} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                  <div className={`p-2.5 rounded-lg max-w-[85%] w-fit text-sm shadow-sm ${msg.role === 'user' ? 'chat-message-user' : 'chat-message-gemini'}`}>
                                      <p className="chat-text" >{msg.text}</p>
                                  </div>
                              </div>
                          ))}
                          {fetcher.state === 'submitting' && (
                              <div className="flex justify-start">
                                  <div className="p-2.5 rounded-lg chat-message-gemini text-gray-600 dark:text-gray-400 text-sm italic w-fit shadow-sm">Gemini is thinking...</div>
                              </div>
                          )}
                          {gameFinished && (
                              <div className="p-3 rounded-lg bg-yellow-100 dark:bg-yellow-700 text-yellow-800 dark:text-yellow-100 text-center text-sm font-semibold w-full mt-2 shadow">
                                  Game Over! 🎉 Well done! Click "New Game" to play again.
                              </div>
                          )}
                      </div>
                      {/* Chat Input Form */}
                      <fetcher.Form onSubmit={handleSendMessage} method="post" className="mt-auto flex-shrink-0">
                          <div className="flex items-center gap-2 border border-gray-300 dark:border-gray-600 rounded-lg p-2 focus-within:ring-2 focus-within:ring-blue-500">
                              <input
                                  type="text"
                                  name="userAttempt" // Name needed for fetcher.Form internals if not using formData.set explicitly
                                  value={currentInput}
                                  onChange={(e) => setCurrentInput(e.target.value)}
                                  placeholder={gameFinished ? "Game finished! Start a new game." : "Describe a feature..."}
                                  className="flex-1 p-2 border-none focus:ring-0 bg-transparent dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                                  disabled={fetcher.state !== 'idle' || gameFinished || isLoading}
                                  autoComplete="off"
                              />
                              <button
                                  type="submit"
                                  className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800"
                                  disabled={fetcher.state !== 'idle' || gameFinished || !currentInput.trim() || isLoading}
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
