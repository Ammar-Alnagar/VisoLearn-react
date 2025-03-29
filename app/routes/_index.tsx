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
import {
  generateImageFeatures,
  generateImage,
  type ChatEntry as ApiChatEntry,
} from "~/utils/gemini.server.ts";
import type { ShouldRevalidateFunction } from "@remix-run/react";

export interface ImageData {
  id: string;
  url: string;
  alt: string;
  features: string[];
  difficulty: "easy" | "medium" | "hard";
}

export const meta: MetaFunction = () => {
  return [
    { title: "VisoLearn React Version" },
    { name: "description", content: "Describe images with hints from Gemini!" },
  ];
};

const STORAGE_KEY_GAME_STATE = "geminiImageDescriberGameState";

interface DisplayChatEntry {
  role: "user" | "model";
  text: string;
}

interface GameState {
  image: ImageData | null;
  chatHistory: DisplayChatEntry[];
  correctFeatures: string[];
  gameTrulyFinished: boolean;
  thresholdMet: boolean;
  allFeaturesFound: boolean;
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
  animatingFeatures: string[]; // New field for animation tracking
}

interface LoaderData {
  newGameData?: {
    image: ImageData;
    maxAttempts: number;
    winThreshold: number;
    userInput: GameState["userInput"];
  };
  initialStateData: {
    maxAttempts: number;
    winThreshold: number;
  };
  loaderIndicatesActiveGame: boolean;
  error?: string;
}

interface ActionData {
  message?: string;
  error?: string;
  gameTrulyFinished?: boolean;
  allFeaturesFound?: boolean;
  correctFeatures?: string[];
  attemptsRemaining?: number;
  updatedChatHistory?: ApiChatEntry[];
  newlyFoundFeatures?: string[]; // New field for animation
}

export const loader = async ({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> => {
  const timestamp = new Date().toISOString();
  console.log(`\n--- LOADER EXECUTING (${timestamp}) ---`);
  const url = new URL(request.url);
  const searchParams = url.searchParams;
  console.log(`>>> LOADER PARAMS: ${searchParams.toString()}`);

  const attemptsStr = searchParams.get("attempts") || "10";
  const thresholdStr = searchParams.get("threshold") || "4";
  let attempts = parseInt(attemptsStr, 10);
  if (isNaN(attempts)) { attempts = 10; }
  let threshold = parseInt(thresholdStr, 10);
  if (isNaN(threshold)) threshold = 4;

  const initialStateData = { maxAttempts: attempts, winThreshold: threshold };

  const isExplicitNewGame = searchParams.get("startNewGame") === "true";
  console.log(
    `Loader (${timestamp}): Is this an explicit new game request? ${isExplicitNewGame}`
  );

  if (isExplicitNewGame) {
    console.log(`>>> !!! LOADER triggered NEW GAME GENERATION (Explicit) !!!`);
    const difficultyParam = searchParams.get("difficulty");
    const difficulty =
      difficultyParam === "easy" ||
      difficultyParam === "medium" ||
      difficultyParam === "hard"
        ? difficultyParam
        : null;
    const topic = searchParams.get("topic");
    const age = searchParams.get("age") || "";
    const style = searchParams.get("style") || "any";

    if (difficulty && topic) {
      console.log(
        `Loader (${timestamp}): New game params valid (difficulty=${difficulty}, topic=${topic}). Generating image...`
      );
      const imageGenPrompt = `Generate an image suitable for a ${difficulty} description game. User age: ${
        age || "unspecified"
      }. Style: ${style}. Topic: ${topic}. Ensure distinct, describable features.`;

      let generatedImageData: ImageData | null = null;
      let errorMsg: string | undefined = undefined;

      try {
        const dynamicImageResult = await generateImage(imageGenPrompt);

        if (dynamicImageResult?.url && dynamicImageResult?.alt) {
          console.log(
            `Loader (${timestamp}): Image generated successfully (Data URL). Generating features...`
          );
          const generatedFeatures = await generateImageFeatures(
            dynamicImageResult.alt
          );
          const features =
            generatedFeatures.length >= 3
              ? generatedFeatures
              : ["object", "color", "action", "setting"];
          console.log(`Loader (${timestamp}): Features generated:`, features);

          generatedImageData = {
            id: `gen-${Date.now()}`,
            url: dynamicImageResult.url,
            alt: dynamicImageResult.alt,
            features: features,
            difficulty: difficulty,
          };
          console.log(
            "Loader: Dynamically generated image data:",
            generatedImageData
          );
        } else {
          console.warn(
            "Loader: Gemini image generation returned null or incomplete data."
          );
          errorMsg =
            "Failed to generate image from Gemini. Please try different parameters.";
        }
      } catch (error: any) {
        console.error("Loader: Error during image/feature generation:", error);
        errorMsg = `Error generating image or features: ${
          error.message || "Unknown error"
        }. Please try again.`;
      }

      if (!generatedImageData) {
        console.error(
          "Loader: Failed to create generatedImageData. Returning error."
        );
        return {
          error:
            errorMsg ??
            "Could not generate image for the specified parameters.",
          loaderIndicatesActiveGame: false,
          initialStateData: initialStateData,
        };
      }

      console.log("Loader: Returning NEW game data.");
      const currentUserInput: GameState["userInput"] = {
        age,
        level: difficulty,
        style,
        topic,
        attempts: String(attempts),
        threshold: String(threshold),
      };

      return {
        newGameData: {
          image: generatedImageData,
          maxAttempts: attempts,
          winThreshold: threshold,
          userInput: currentUserInput,
        },
        loaderIndicatesActiveGame: true,
        initialStateData: initialStateData,
        error: errorMsg,
      };
    } else {
      console.warn(
        `Loader (${timestamp}): Explicit new game request, but missing difficulty or topic.`
      );
      return {
        error:
          "Missing required parameters (difficulty, topic) to start a new game.",
        loaderIndicatesActiveGame: false,
        initialStateData: initialStateData,
      };
    }
  } else {
    const imageId = searchParams.get("imageId");
    const loaderIndicatesActiveGame = !!imageId;
    console.log(
      `Loader (${timestamp}): Not an explicit new game request. Active game indicated by URL (imageId=${imageId})? ${loaderIndicatesActiveGame}`
    );
    return {
      loaderIndicatesActiveGame: loaderIndicatesActiveGame,
      initialStateData: initialStateData,
    };
  }
};

export const shouldRevalidate: ShouldRevalidateFunction = ({
  actionResult,
  currentParams,
  currentUrl,
  defaultShouldRevalidate,
  formAction,
  formData,
  formEncType,
  formMethod,
  nextParams,
  nextUrl,
  submission,
}) => {
  const nextSearchParams = new URLSearchParams(nextUrl.search);

  if (
    formMethod?.toLowerCase() === "get" &&
    nextSearchParams.get("startNewGame") === "true"
  ) {
    console.log(
      "shouldRevalidate: YES - Explicit new game requested via GET navigation."
    );
    return true;
  }

  const actionTarget = submission?.action ?? formAction;
  if (actionTarget?.endsWith("/api/chat")) {
    console.log("shouldRevalidate: NO - Chat action submission.");
    return false;
  }

  console.log(
    "shouldRevalidate: Defaulting - Not a new game GET or chat POST."
  );
  return defaultShouldRevalidate;
};

export default function Index() {
  const loaderData = useLoaderData<LoaderData>();
  const fetcher = useFetcher<ActionData>();
  const submit = useSubmit();
  const navigation = useNavigation();

  const isSubmittingStartForm =
    navigation.state === "loading" &&
    navigation.location?.search?.includes("startNewGame=true");

  const isSubmittingChat = fetcher.state !== "idle";

  const [isClient, setIsClient] = React.useState(false);
  const [gameState, setGameState] = React.useState<GameState>(() => {
    const defaultState: GameState = {
      image: null,
      chatHistory: [],
      correctFeatures: [],
      gameTrulyFinished: false,
      thresholdMet: false,
      allFeaturesFound: false,
      gameStarted: false,
      attemptsRemaining: loaderData.initialStateData.maxAttempts,
      maxAttempts: loaderData.initialStateData.maxAttempts,
      winThreshold: loaderData.initialStateData.winThreshold,
      userInput: null,
      animatingFeatures: [], // Initialize animation array
    };
    console.log(
      "useState [gameState]: Initializing component state:",
      defaultState
    );
    return defaultState;
  });

  const {
    image,
    chatHistory,
    correctFeatures,
    gameTrulyFinished,
    thresholdMet,
    allFeaturesFound,
    gameStarted,
    attemptsRemaining,
    maxAttempts,
    winThreshold,
    userInput,
    animatingFeatures,
  } = gameState;
  const [currentInput, setCurrentInput] = React.useState("");
  const chatContainerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    setIsClient(true);
    console.log("useEffect [isClient]: Component hydrated.");
  }, []);

  React.useEffect(() => {
    if (!isClient) return;
    console.log(
      "useEffect [isClient, loaderData]: Running game state initialization/restore logic."
    );

    const currentUrl = new URL(window.location.href);
    const urlImageId = currentUrl.searchParams.get("imageId");

    if (loaderData.newGameData) {
      console.log(
        "useEffect [isClient, loaderData]: New game data found in loader. Initializing state."
      );
      const {
        image: newImage,
        maxAttempts: newMax,
        winThreshold: newThreshold,
        userInput: newUserInput,
      } = loaderData.newGameData;
      setGameState({
        image: newImage,
        chatHistory: [],
        correctFeatures: [],
        gameTrulyFinished: false,
        thresholdMet: false,
        allFeaturesFound: false,
        gameStarted: true,
        attemptsRemaining: newMax,
        maxAttempts: newMax,
        winThreshold: newThreshold,
        userInput: newUserInput,
        animatingFeatures: [],
      });

      const searchParams = new URLSearchParams();
      searchParams.set("imageId", String(newImage.id));
      searchParams.set("attempts", String(newMax));
      searchParams.set("threshold", String(newThreshold));
      if (newUserInput) {
        searchParams.set("topic", newUserInput.topic);
        searchParams.set("difficulty", newUserInput.level);
        searchParams.set("style", newUserInput.style);
        searchParams.set("age", newUserInput.age);
      }
      window.history.replaceState(null, "", `?${searchParams.toString()}`);
      console.log(
        "useEffect [isClient, loaderData]: Cleared localStorage (new game). Updated URL (removed startNewGame)."
      );
      localStorage.removeItem(STORAGE_KEY_GAME_STATE);
    } else {
      console.log(
        "useEffect [isClient, loaderData]: No new game data in loader. Checking localStorage."
      );
      const savedStateRaw = localStorage.getItem(STORAGE_KEY_GAME_STATE);
      let restoredState: GameState | null = null;

      if (savedStateRaw) {
        try {
          const savedState = JSON.parse(savedStateRaw) as GameState;
          if (
            savedState.image &&
            savedState.gameStarted &&
            !savedState.gameTrulyFinished &&
            urlImageId &&
            String(savedState.image.id) === urlImageId
          ) {
            console.log(
              "useEffect [isClient, loaderData]: Valid localStorage state found matching URL imageId. Restoring."
            );
            restoredState = savedState;
            setGameState({
              ...savedState,
              maxAttempts: loaderData.initialStateData.maxAttempts,
              winThreshold: loaderData.initialStateData.winThreshold,
              attemptsRemaining: Math.min(
                Math.max(savedState.attemptsRemaining, 0),
                loaderData.initialStateData.maxAttempts
              ),
              animatingFeatures: [], // Reset animations on restore
            });
            const searchParams = new URLSearchParams(window.location.search);
            searchParams.set("imageId", String(savedState.image.id));
            searchParams.set(
              "attempts",
              String(loaderData.initialStateData.maxAttempts)
            );
            searchParams.set(
              "threshold",
              String(loaderData.initialStateData.winThreshold)
            );
            if (savedState.userInput) {
              searchParams.set("topic", savedState.userInput.topic);
              searchParams.set("difficulty", savedState.userInput.level);
              searchParams.set("style", savedState.userInput.style);
              searchParams.set("age", savedState.userInput.age);
            }
            window.history.replaceState(
              null,
              "",
              `?${searchParams.toString()}`
            );
          } else {
            console.log(
              "useEffect [isClient, loaderData]: localStorage state invalid, finished, or mismatch with URL imageId. Clearing LS."
            );
            localStorage.removeItem(STORAGE_KEY_GAME_STATE);
          }
        } catch (e) {
          console.error(
            "useEffect [isClient, loaderData]: Failed to parse saved game state:",
            e
          );
          localStorage.removeItem(STORAGE_KEY_GAME_STATE);
        }
      } else {
        console.log(
          "useEffect [isClient, loaderData]: No saved game state found in localStorage."
        );
      }

      if (!restoredState) {
        console.log(
          "useEffect [isClient, loaderData]: No new game and no restore. Ensuring setup screen state."
        );
        if (urlImageId) {
          console.log(
            "useEffect [isClient, loaderData]: URL has imageId but no state found/restored. Resetting URL to /"
          );
          window.history.replaceState(null, "", "/");
        }
        setGameState({
          image: null,
          chatHistory: [],
          correctFeatures: [],
          gameTrulyFinished: false,
          thresholdMet: false,
          allFeaturesFound: false,
          gameStarted: false,
          attemptsRemaining: loaderData.initialStateData.maxAttempts,
          maxAttempts: loaderData.initialStateData.maxAttempts,
          winThreshold: loaderData.initialStateData.winThreshold,
          userInput: null,
          animatingFeatures: [],
        });
      }
    }
  }, [isClient, loaderData]);

  React.useEffect(() => {
    if (isClient && gameStarted && !gameTrulyFinished && image) {
      console.log(
        "useEffect [gameState]: Saving active game state to localStorage",
        { id: image.id, attempts: attemptsRemaining }
      );
      const stateToSave: GameState = { ...gameState };
      localStorage.setItem(STORAGE_KEY_GAME_STATE, JSON.stringify(stateToSave));
    } else if (isClient && (gameTrulyFinished || !gameStarted)) {
      if (localStorage.getItem(STORAGE_KEY_GAME_STATE)) {
        console.log(
          "useEffect [gameState]: Game finished or not started, removing state from localStorage"
        );
        localStorage.removeItem(STORAGE_KEY_GAME_STATE);
      }
    }
  }, [gameState, isClient]);

  React.useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      console.log(
        "useEffect [fetcher.data]: Processing fetcher response:",
        fetcher.data
      );
      const {
        message,
        error,
        gameTrulyFinished: finished,
        allFeaturesFound: allFound,
        correctFeatures: newFeatures,
        attemptsRemaining: remaining,
        newlyFoundFeatures,
      } = fetcher.data;

      if (
        message !== undefined ||
        error !== undefined ||
        finished !== undefined ||
        allFound !== undefined ||
        newFeatures !== undefined ||
        remaining !== undefined
      ) {
        setGameState((prev) => {
          if (!prev.gameStarted || !prev.image) {
            console.warn(
              "useEffect [fetcher.data]: Game not started or no image, skipping fetcher state update."
            );
            return prev;
          }
          console.log(
            "useEffect [fetcher.data]: Updating state from fetcher. Prev attempts:",
            prev.attemptsRemaining
          );

          const newHistory = [...prev.chatHistory];
          if (message) {
            newHistory.push({ role: "model", text: `Gemini: ${message}` });
          }

          return {
            ...prev,
            chatHistory: newHistory,
            correctFeatures: newFeatures ?? prev.correctFeatures,
            attemptsRemaining: remaining ?? prev.attemptsRemaining,
            gameTrulyFinished: finished ?? prev.gameTrulyFinished,
            allFeaturesFound: allFound ?? prev.allFeaturesFound,
            animatingFeatures: newlyFoundFeatures || [], // Set animating features
          };
        });

        if (fetcher.data.newlyFoundFeatures?.length > 0) {
          setTimeout(() => {
            setGameState(prev => ({
              ...prev,
              animatingFeatures: [],
            }));
          }, 2000);
        }
      } else {
        console.warn(
          "useEffect [fetcher.data]: Received fetcher data, but it contained no relevant fields to update state.",
          fetcher.data
        );
      }
    }
  }, [fetcher.data, fetcher.state]);

  React.useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop =
        chatContainerRef.current.scrollHeight;
    }
  }, [chatHistory]);

  const handleStartGame = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    console.log("handleStartGame: Form submitted.");
    const formData = new FormData(event.currentTarget);

    formData.append("startNewGame", "true");
    console.log("handleStartGame: Added 'startNewGame=true' to form data.");

    if (isClient) {
      console.log("handleStartGame: Clearing localStorage.");
      localStorage.removeItem(STORAGE_KEY_GAME_STATE);
    }

    setGameState((prev) => ({
      ...prev,
      image: null,
      chatHistory: [],
      correctFeatures: [],
      gameTrulyFinished: false,
      thresholdMet: false,
      allFeaturesFound: false,
      gameStarted: false,
      userInput: null,
      animatingFeatures: [],
      attemptsRemaining:
        parseInt(formData.get("attempts") as string, 10) ||
        loaderData.initialStateData.maxAttempts,
      maxAttempts:
        parseInt(formData.get("attempts") as string, 10) ||
        loaderData.initialStateData.maxAttempts,
      winThreshold:
        parseInt(formData.get("threshold") as string, 10) ||
        loaderData.initialStateData.winThreshold,
    }));

    console.log(
      "handleStartGame: Submitting form via GET to trigger loader for new game..."
    );
    submit(formData, {
      method: "get",
      action: "/",
      replace: true,
    });
  };

  const handleSendMessage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    console.log("handleSendMessage: Chat form submitted.");

    const userMessage = currentInput.trim();

    if (
      !userMessage ||
      !image ||
      !gameStarted ||
      isSubmittingChat ||
      gameTrulyFinished
    ) {
      console.log("handleSendMessage: Submission prevented.", {
        userMessageEmpty: !userMessage,
        imageMissing: !image,
        gameNotStarted: !gameStarted,
        isSubmittingChat,
        gameTrulyFinished,
      });
      return;
    }

    console.log("handleSendMessage: User message:", userMessage);

    setGameState((prev) => {
      if (!prev.gameStarted || prev.gameTrulyFinished) return prev;
      console.log("handleSendMessage: Updating chat history optimistically.");
      return {
        ...prev,
        chatHistory: [
          ...prev.chatHistory,
          { role: "user", text: `User: ${userMessage}` },
        ],
      };
    });
    setCurrentInput("");

    const formData = new FormData();
    formData.append("userAttempt", userMessage);
    formData.append("imageFeatures", JSON.stringify(image.features || []));

    const historyForApi: ApiChatEntry[] = gameState.chatHistory
      .map((entry): ApiChatEntry | null => {
        const text = entry.text.replace(/^(User:|Gemini:|Error:)\s*/, "");
        if (!text && entry.role === "model") return null;
        return {
          role: entry.role === "user" ? "user" : "model",
          parts: [{ text: text }],
        };
      })
      .filter((entry): entry is ApiChatEntry => entry !== null);

    historyForApi.push({ role: "user", parts: [{ text: userMessage }] });

    formData.append("chatHistory", JSON.stringify(historyForApi));
    formData.append(
      "correctFeatures",
      JSON.stringify(gameState.correctFeatures)
    );
    formData.append("attemptsRemaining", String(gameState.attemptsRemaining));
    formData.append("winThreshold", String(gameState.winThreshold));

    console.log(
      "handleSendMessage: Submitting fetcher POST to /api/chat (skipping client revalidation)..."
    );
    fetcher.submit(formData, {
      method: "post",
      action: "/api/chat",
      preventScrollReset: true,
      unstable_skipClientRevalidation: true,
    });
    console.log("handleSendMessage: fetcher.submit called.");
  };

  const handleResetGame = () => {
    console.log("handleResetGame: Resetting game.");
    if (isClient) {
      localStorage.removeItem(STORAGE_KEY_GAME_STATE);
      console.log("handleResetGame: Cleared localStorage.");
    }

    setGameState((prev) => ({
      ...prev,
      image: null,
      chatHistory: [],
      correctFeatures: [],
      gameTrulyFinished: false,
      thresholdMet: false,
      allFeaturesFound: false,
      gameStarted: false,
      userInput: null,
      animatingFeatures: [],
      attemptsRemaining: loaderData.initialStateData.maxAttempts,
      maxAttempts: loaderData.initialStateData.maxAttempts,
      winThreshold: loaderData.initialStateData.winThreshold,
    }));

    submit(null, {
      method: "get",
      action: "/",
      replace: true,
    });
  };

  const showLoadingOverlay = isSubmittingStartForm;
  const showSetupScreen = isClient && !gameStarted && !loaderData.newGameData;
  const showGameScreen = isClient && gameStarted && image;

  let statusMessage = null;
  let statusMessageColor = "";
  if (gameTrulyFinished) {
    if (allFeaturesFound) {
      statusMessage = "Congratulations! You found all the features! 🎉";
      statusMessageColor =
        "bg-green-100 dark:bg-green-800 text-green-800 dark:text-green-100";
    } else if (thresholdMet) {
      statusMessage = `Game Over! Threshold reached, but you ran out of attempts. Features were: ${
        image?.features?.join(", ") || "N/A"
      }.`;
      statusMessageColor =
        "bg-yellow-100 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200";
    } else {
      statusMessage = `Game Over! You ran out of attempts. The features were: ${
        image?.features?.join(", ") || "N/A"
      }.`;
      statusMessageColor =
        "bg-red-100 dark:bg-red-800 text-red-800 dark:text-red-100";
    }
  } else if (thresholdMet) {
    statusMessage = `Threshold reached! (${
      correctFeatures.length
    }/${winThreshold}) Keep going to find all ${
      image?.features?.length ?? "?"
    } features.`;
    statusMessageColor =
      "bg-yellow-100 dark:bg-yellow-800 text-yellow-800 dark:text-yellow-200";
  }

  const loaderError = loaderData.error;

  return (
    <div className="flex flex-col h-screen bg-gray-100 dark:bg-gray-900 text-gray-900 dark:text-gray-100 font-sans relative">
      {showLoadingOverlay && (
        <div className="absolute inset-0 bg-gray-500 bg-opacity-50 dark:bg-gray-800 dark:bg-opacity-60 flex justify-center items-center z-50">
          <div className="text-white text-xl font-semibold animate-pulse p-4 bg-black/50 rounded-lg">
            Generating your game...
          </div>
        </div>
      )}

      <header className="p-4 border-b border-gray-200 dark:border-gray-700 flex-shrink-0">
        <h1 className="text-xl sm:text-2xl font-semibold text-center">
          VisoLearn: Image Describer
        </h1>
      </header>

      <main className="flex-1 overflow-hidden p-2 sm:p-4">
        {showSetupScreen && (
          <div className="max-w-lg mx-auto mt-8 bg-white dark:bg-gray-800 p-6 rounded-lg shadow-md">
            {loaderError && (
              <div className="mb-4 p-3 text-red-700 bg-red-100 dark:bg-red-900 dark:text-red-200 rounded border border-red-300 dark:border-red-700">
                <p>
                  <strong>Error starting previous game:</strong> {loaderError}
                </p>
                <p className="text-xs mt-1">
                  Please adjust settings and try again.
                </p>
              </div>
            )}
            <h2 className="text-xl font-semibold mb-5 text-center">
              Start a New Game
            </h2>
            <Form
              onSubmit={handleStartGame}
              method="get"
              action="/"
              replace
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
                  defaultValue={
                    loaderData.initialStateData?.userInput?.topic ??
                    "a cute cat"
                  }
                  placeholder="e.g., futuristic city, dog playing fetch"
                  required
                  className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label
                    htmlFor="difficulty"
                    className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >
                    Difficulty:
                  </label>
                  <select
                    id="difficulty"
                    name="difficulty"
                    defaultValue={
                      loaderData.initialStateData?.userInput?.level ?? "easy"
                    }
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
                    defaultValue={
                      loaderData.initialStateData?.userInput?.style ??
                      "illustration"
                    }
                    placeholder="e.g., cartoon, realistic, abstract"
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
                    defaultValue={
                      loaderData.initialStateData?.userInput?.age ?? ""
                    }
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
                    defaultValue={String(
                      loaderData.initialStateData.maxAttempts
                    )}
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
                    Feature Threshold:
                  </label>
                  <input
                    type="number"
                    id="threshold"
                    name="threshold"
                    defaultValue={String(
                      loaderData.initialStateData.winThreshold
                    )}
                    min="1"
                    max="20"
                    required
                    className="w-full p-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={isSubmittingStartForm}
                className="w-full bg-blue-600 text-white p-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-wait"
              >
                {isSubmittingStartForm ? "Starting..." : "Start Game"}
              </button>
            </Form>
          </div>
        )}

        {showGameScreen && (
          <div className="flex flex-col lg:flex-row h-full gap-4">
            <div className="w-full lg:w-1/2 xl:w-2/5 flex flex-col bg-white dark:bg-gray-800 p-4 rounded-lg shadow overflow-hidden">
              <h2 className="text-lg font-semibold mb-3 text-center flex-shrink-0">
                Describe this Image:
              </h2>
              <div className="flex-grow flex justify-center items-center min-h-[250px] mb-3 overflow-hidden relative bg-gray-200 dark:bg-gray-700 rounded">
                {image ? (
                  <img
                    key={image.id}
                    src={image.url}
                    alt={image.alt || "Generated image"}
                    className={`max-w-full max-h-full object-contain rounded transition-opacity duration-500 ease-in-out opacity-100`}
                  />
                ) : (
                  <div className="text-gray-500 dark:text-gray-400 p-4 text-center">
                    Image loading or missing...
                  </div>
                )}
              </div>
              <div className="text-xs sm:text-sm text-gray-600 dark:text-gray-400 w-full flex-shrink-0 border-t dark:border-gray-700 pt-3 mt-auto space-y-1">
                <p>
                  <b>Difficulty:</b>{" "}
                  {image?.difficulty ?? userInput?.level ?? "N/A"}
                </p>
                <p>
                  <b>Topic:</b> {userInput?.topic || "N/A"}
                </p>
                <p
                  className={`font-medium ${
                    attemptsRemaining <= 3 &&
                    attemptsRemaining > 0 &&
                    !gameTrulyFinished
                      ? "text-orange-500 dark:text-orange-400"
                      : attemptsRemaining <= 0
                      ? "text-red-600 dark:text-red-400"
                      : ""
                  }`}
                >
                  <b>Attempts Remaining:</b> {attemptsRemaining} / {maxAttempts}
                </p>
                <p>
                  <b>Feature Threshold:</b> {winThreshold}
                </p>
                <p
                  className={
                    thresholdMet && !allFeaturesFound && !gameTrulyFinished
                      ? "font-semibold text-yellow-600 dark:text-yellow-400"
                      : allFeaturesFound
                      ? "font-semibold text-green-600 dark:text-green-400"
                      : ""
                  }
                >
                  <b>Features Found:</b> {correctFeatures.length} /{" "}
                  {image?.features?.length ?? "?"}
                  {thresholdMet &&
                    !allFeaturesFound &&
                    !gameTrulyFinished &&
                    " (Threshold Met!)"}
                  {allFeaturesFound && " (All Found!)"}
                </p>
                {image?.features && image.features.length > 0 ? (
                  <ul className="list-disc pl-5 text-xs max-h-24 overflow-y-auto">
                    {image.features.map((feature) => {
                      const lowerFeature = feature.toLowerCase();
                      const found = correctFeatures.some(
                        (cf) => cf.toLowerCase() === lowerFeature
                      );
                      const isAnimating = animatingFeatures.includes(feature);

                      return (
                        <li
                          key={feature}
                          className={`transition-all duration-300 ${
                            found
                              ? "text-green-600 dark:text-green-400"
                              : "text-gray-500 dark:text-gray-400"
                          } ${
                            isAnimating ? "scale-110 font-bold animate-pulse" : ""
                          }`}
                        >
                          {found ? feature : "???"}{" "}
                          {isAnimating && "✨"}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="text-xs text-gray-400 italic">
                    No features defined for this image.
                  </p>
                )}
                {loaderError && !showSetupScreen && (
                  <p className="text-xs text-yellow-600 dark:text-yellow-400 mt-1">
                    Note: There was an issue generating this game ({loaderError})
                  </p>
                )}
              </div>
              <button
                onClick={handleResetGame}
                disabled={isSubmittingStartForm || isSubmittingChat}
                className="mt-4 w-full bg-gray-500 text-white p-2 rounded-lg hover:bg-gray-600 transition-colors text-sm flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                New Game / Change Settings
              </button>
            </div>

            <div className="w-full lg:w-1/2 xl:w-3/5 flex flex-col bg-white dark:bg-gray-800 p-4 rounded-lg shadow">
              <h2 className="text-lg font-semibold mb-3 flex-shrink-0">
                Chat with Gemini
              </h2>
              <div
                ref={chatContainerRef}
                className="flex-1 overflow-y-auto mb-4 p-3 space-y-3 bg-gray-50 dark:bg-gray-700 rounded-md border border-gray-200 dark:border-gray-600 min-h-[200px]"
              >
                <div className="flex justify-start">
                  <div className="p-2.5 rounded-lg bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-100 text-sm shadow-sm w-fit">
                    Gemini: Describe a feature you see in the image!
                  </div>
                </div>
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
                          ? "bg-blue-500 text-white dark:bg-blue-600"
                          : msg.text.startsWith("Error:")
                          ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                          : "bg-gray-200 text-gray-800 dark:bg-gray-600 dark:text-gray-100"
                      }`}
                    >
                      {msg.text.split("\n").map((line, i) => (
                        <p key={i}>{line || "\u00A0"}</p>
                      ))}
                    </div>
                  </div>
                ))}
                {isSubmittingChat && (
                  <div className="flex justify-start">
                    <div className="p-2.5 rounded-lg bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-400 text-sm italic w-fit shadow-sm animate-pulse">
                      Gemini is thinking...
                    </div>
                  </div>
                )}
                {statusMessage && (
                  <div
                    className={`p-3 rounded-lg ${statusMessageColor} text-center text-sm font-semibold w-full mt-2 shadow`}
                  >
                    {statusMessage}{" "}
                    {gameTrulyFinished && 'Click "New Game" to play again.'}
                  </div>
                )}
              </div>
              <form
                onSubmit={handleSendMessage}
                className="mt-auto flex-shrink-0"
              >
                <div className="flex items-center gap-2 border border-gray-300 dark:border-gray-600 rounded-lg p-2 focus-within:ring-2 focus-within:ring-blue-500">
                  <input
                    type="text"
                    value={currentInput}
                    onChange={(e) => setCurrentInput(e.target.value)}
                    placeholder={
                      gameTrulyFinished
                        ? "Game finished! Start a new game."
                        : "Describe a feature..."
                    }
                    className="flex-1 p-2 border-none focus:ring-0 bg-transparent dark:text-gray-100 placeholder-gray-500 dark:placeholder-gray-400"
                    disabled={
                      isSubmittingChat ||
                      gameTrulyFinished ||
                      isSubmittingStartForm
                    }
                    autoComplete="off"
                    aria-label="Chat input"
                  />
                  <button
                    type="submit"
                    className="bg-blue-600 text-white p-2 rounded-md hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800"
                    disabled={
                      isSubmittingChat ||
                      gameTrulyFinished ||
                      !currentInput.trim() ||
                      isSubmittingStartForm
                    }
                    aria-label="Send message"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                      className="w-5 h-5"
                    >
                      <path d="M3.105 3.105a1.5 1.5 0 012.122-.001L19.43 14.29a1.5 1.5 0 01-1.13 2.576H1.5a1.5 1.5 0 01-1.49-1.813L3.105 3.105zM4.879 6.121L1.5 15.43h14.805L4.879 6.12z" />
                    </svg>
                  </button>
                </div>
                {fetcher.data?.error && (
                  <p className="text-xs text-red-500 dark:text-red-400 mt-1 text-center">
                    Chat Error: {fetcher.data.error}
                  </p>
                )}
              </form>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
