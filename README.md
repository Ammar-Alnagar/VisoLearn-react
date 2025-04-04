# VisoLearn - AI-Powered Image Description Game


<div style="width: 100%; text-align: center;">
    <img src="logo.jpeg" alt="VisoLearn Logo" width="800" style="display: block; margin: auto; border-radius: 10px;">
</div>


[![License](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-20232A?style=flat-square&logo=react&logoColor=61DAFB)](https://reactjs.org/)
[![Remix](https://img.shields.io/badge/Remix-000000?style=flat-square&logo=remix&logoColor=white)](https://remix.run)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=flat-square&logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Google Cloud](https://img.shields.io/badge/Google_Cloud-4285F4?style=flat-square&logo=google-cloud&logoColor=white)](https://cloud.google.com/)
[![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org/)
## 📖 Table of Contents
1. [Overview](#overview)
2. [Core Features](#core-features)
3. [Technical Architecture](#technical-architecture)
4. [Game Mechanics](#game-mechanics)
5. [Implementation Details](#implementation-details)
6. [Setup Guide](#setup-guide)
7. [Development Guide](#development-guide)
8. [API Integration](#api-integration)
9. [User Interface](#user-interface)
10. [Performance Optimizations](#performance-optimizations)
11. [Troubleshooting](#troubleshooting)
12. [Contributing](#contributing)
13. [Advanced Configuration](#advanced-configuration)
14. [Data Architecture](#data-architecture)
15. [Data Flow](#data-flow)
16. [Flow Charts](#flow-charts)

## 🌟 Overview

VisoLearn is a sophisticated web application that combines cutting-edge AI technology with gamification to create an engaging image description learning experience. The application leverages Google's Gemini AI to generate unique images and provide intelligent feedback, making it an ideal tool for language learning, observation skills development, and educational purposes.

## 💫 Core Features

### Image Generation System
- **Dynamic Image Creation**
  - Real-time image generation based on user parameters
  - Content-aware feature generation
  - Safety-filtered output ensuring appropriate content
  - Customizable style and complexity levels

### Interactive Game System
- **Adaptive Difficulty**
  - Three difficulty levels: Easy, Medium, Hard
  - Dynamic feature complexity adjustment
  - Progressive hint system
  - Customizable winning conditions

### AI Chat Interface
- **Intelligent Feedback**
  - Context-aware responses
  - Progressive hint system
  - Natural language processing
  - Adaptive learning patterns

### Progress Tracking
- **Real-time Statistics**
  - Feature discovery tracking
  - Attempt counting
  - Success rate calculation
  - Session persistence

## 🏗 Technical Architecture

### Frontend Architecture
```typescript
// Core Component Structure
root/
├── components/
│   ├── GameBoard/
│   ├── ChatInterface/
│   └── ProgressTracker/
├── routes/
│   ├── _index.tsx        // Main game interface
│   └── api/
│       └── chat.ts       // Chat endpoint
└── utils/
    └── gemini.server.ts  // AI integration
```

### State Management
```typescript
// Core Game State Interface
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
  userInput: UserInputConfig | null;
  animatingFeatures: string[];
}
```

## 🎮 Game Mechanics

### Feature Discovery System
1. **Input Processing**
   ```typescript
   const processUserInput = (input: string): FeatureMatch[] => {
     return features.filter(feature =>
       matchFeature(input.toLowerCase(), feature.toLowerCase())
     );
   };
   ```

2. **Scoring Algorithm**
   ```typescript
   const calculateScore = (
     foundFeatures: string[],
     totalFeatures: string[],
     threshold: number
   ): GameScore => {
     const score = foundFeatures.length;
     const thresholdMet = score >= threshold;
     const complete = score === totalFeatures.length;
     return { score, thresholdMet, complete };
   };
   ```

### Hint Generation System
- Contextual awareness of previous attempts
- Progressive specificity based on attempts remaining
- Location-based hints for spatial features
- Category-based hints for conceptual features

## 🔧 Implementation Details

### Gemini AI Integration
```typescript
// Sample AI Configuration
const generationConfig = {
  temperature: 0.8,
  topP: 1,
  topK: 32,
  maxOutputTokens: 256,
};

const safetySettings = [
  {
    category: HarmCategory.HARM_CATEGORY_HARASSMENT,
    threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
  },
  // Additional safety configurations...
];
```

### State Persistence
```typescript
// Local Storage Management
const persistGameState = (state: GameState) => {
  localStorage.setItem(STORAGE_KEY_GAME_STATE, JSON.stringify(state));
};

const restoreGameState = (): GameState | null => {
  const saved = localStorage.getItem(STORAGE_KEY_GAME_STATE);
  return saved ? JSON.parse(saved) : null;
};
```

## 🚀 Setup Guide

### Environment Configuration
```bash
# Required Environment Variables
GEMINI_API_KEY=your_api_key_here
NODE_ENV=development|production
PORT=3000
```

### Installation Steps
```bash
# Install dependencies
npm install

# Setup development environment
npm run setup

# Configure environment variables
cp .env.example .env
```

## 💻 Development Guide

### Local Development
```bash
# Start development server
npm run dev

# Run type checking
npm run typecheck

# Run linting
npm run lint
```

### Build Process
```bash
# Create production build
npm run build

# Start production server
npm start
```

## 🔌 API Integration

### Gemini AI Endpoints
```typescript
// Image Generation
export async function generateImage(prompt: string): Promise<ImageData | null>;

// Feature Extraction
export async function generateImageFeatures(
  imageDescription: string
): Promise<string[]>;

// Hint Generation
export async function getGeminiHint(
  targetFeatures: string[],
  userAttempt: string,
  chatHistory: ChatEntry[]
): Promise<string>;
```

## 🎨 User Interface

### Responsive Design
- Mobile-first approach
- Breakpoint system:
  ```css
  /* Breakpoint examples */
  sm: '640px'
  md: '768px'
  lg: '1024px'
  xl: '1280px'
  2xl: '1536px'
  ```

### Theme System
```css
/* Dark mode support */
@media (prefers-color-scheme: dark) {
  :root {
    --bg-primary: theme('colors.gray.900');
    --text-primary: theme('colors.gray.100');
  }
}
```

## ⚡ Performance Optimizations

### Image Loading
- Lazy loading for images
- Progressive image loading
- Optimal image sizing
- Cache management

### State Updates
- Debounced user input
- Optimistic UI updates
- Efficient re-rendering strategies
- Memoized computations

## 🔍 Troubleshooting

### Common Issues
1. **API Connection Issues**
   - Check API key configuration
   - Verify network connectivity
   - Review rate limiting

2. **State Persistence Problems**
   - Clear localStorage
   - Reset game state
   - Check browser compatibility

## 🤝 Contributing

### Development Process
1. Fork the repository
2. Create feature branch
3. Implement changes
4. Write tests
5. Submit pull request

### Code Style
- Follow TypeScript best practices
- Use Prettier for formatting
- Follow ESLint rules
- Write documentation

## ⚙️ Advanced Configuration

### Custom Game Rules
```typescript
interface GameConfig {
  maxAttempts: number;
  winThreshold: number;
  difficulty: 'easy' | 'medium' | 'hard';
  features: number;
  timeLimit?: number;
}
```

### AI Parameters
```typescript
interface AIConfig {
  temperature: number;
  topP: number;
  topK: number;
  maxTokens: number;
  safetyLevel: SafetyLevel;
}
```

## 📊 Data Architecture

VisoLearn employs a client-centric data architecture, primarily relying on client-side state management and browser local storage for persistence within a single game session.

- **Client-Side State (`GameState`):** Managed within the `_index.tsx` component using React's `useState`. Holds all transient game information (current image, chat history, found features, attempts remaining, etc.).
- **Local Storage:** Used to persist the `GameState` across page reloads within the same game instance. The state is saved whenever it changes and restored on component mount if a valid, non-finished game is detected for the current `imageId` in the URL.
- **Server-Side (Remix Backend):**
    - **Loader (`loader` function in `_index.tsx`):** Handles initial game setup requests. It receives user parameters (topic, difficulty, etc.), interacts with `gemini.server.ts` to generate a new image and its features, and returns this data to the client. It also provides default configuration values.
    - **API Endpoint (`api/chat.ts`):** Handles user chat messages. Receives the user's attempt, current game state fragments (features, history, etc.), interacts with `gemini.server.ts` for hints/validation, and returns the updated game state information (new messages, found features, attempts remaining).
    - **`gemini.server.ts`:** Contains server-side logic to interact with the Google Gemini API for image generation, feature extraction, and chat responses/hints. It isolates API key usage and complex interactions from the client.
- **Image Data:**
    - **Dynamic Generation:** Images are generated by the Gemini API via `gemini.server.ts` during the loader execution for a new game. The image data (as a Base64 Data URL) and associated features are passed to the client.
    - **Static (Removed):** The previous static image data structure in `app/data/images.server.ts` is no longer the primary source but served as an initial example.

## 💧 Data Flow

The data flow primarily revolves around the user initiating actions and the client-server communication managed by Remix.

1.  **Game Setup:**
    - User fills the setup form (`_index.tsx`).
    - On submit, a `GET` request is made to the `loader` function (`_index.tsx`) with `startNewGame=true` and user parameters.
    - `loader` calls `generateImage` and `generateImageFeatures` in `gemini.server.ts`.
    - `gemini.server.ts` calls the Google Gemini API.
    - `loader` receives image data (URL, alt, features) and configuration (attempts, threshold).
    - `loader` returns `newGameData` to the client.
    - Client (`_index.tsx`) initializes `GameState` with `newGameData`, updates the URL (removing `startNewGame`, adding `imageId`), and clears local storage.

2.  **Chat Interaction:**
    - User types a message and submits the chat form (`_index.tsx`).
    - Client optimistically updates the `chatHistory` in `GameState`.
    - Client sends a `POST` request via `fetcher` to `/api/chat`. The request includes the user attempt, image features, chat history, correct features, attempts remaining, and win threshold.
    - The `action` function in `api/chat.ts` receives the data.
    - `action` calls `getGeminiHint` in `gemini.server.ts`, passing relevant game state.
    - `gemini.server.ts` calls the Google Gemini API (text model) with the history and prompt.
    - `action` receives the hint/response from Gemini.
    - `action` processes the user attempt against `imageFeatures`, updates `correctFeatures` and `attemptsRemaining`, determines game end conditions (`allFeaturesFound`, `gameTrulyFinished`).
    - `action` returns JSON data (`ActionResponseData`) including the Gemini message, updated game state, and newly found features.
    - Client (`_index.tsx`) receives the `fetcher.data` and updates the `GameState` accordingly (chat history, features, attempts, game status, animating features).

3.  **State Persistence:**
    - On any change to `GameState` (`_index.tsx`), a `useEffect` hook saves the current state to local storage *if* the game is active and not finished.
    - On component mount (`_index.tsx`), another `useEffect` checks local storage. If a saved state exists and matches the `imageId` in the URL, it restores the game state. Otherwise, it ensures the setup screen is shown or initializes a new game based on loader data.

## 📈 Flow Charts

*(Simplified Textual Representations)*

**1. Start New Game Flow:**

```mermaid
flowchart TD
    A([Start]) --> B{Game Active in<br/>Local Storage?}
    B -->|Yes| C[Clear Local Storage]
    B -->|No| D[Show Setup Form]
    C --> D
    D --> E[User Fills Form<br/>Topic, Difficulty]
    E --> F[User Submits Form]
    F --> G[Submit GET Request<br/>startNewGame=true]
    G --> H[Loader Receives<br/>Parameters]
    H --> I[Call Gemini API<br/>Generate Content]
    I --> J[Receive Image Data]
    J --> K[Return newGameData]
    K --> L[Initialize GameState]
    L --> M[Update URL with imageId]
    M --> N[Display Game Screen]
```

**2. User Chat Message Flow:**

```mermaid
flowchart TD
    A([Start]) --> B{Valid Input &<br/>Game Active?}
    B -->|No| C[Ignore Input]
    B -->|Yes| D[Add Message to<br/>Chat History]
    D --> E[POST to /api/chat]
    E --> F[Process Request]
    F --> G[Generate AI Response]
    G --> H[Check Features]
    H --> I{Features Found?}
    I -->|Yes| J[Update Score]
    I -->|No| K{Help Request?}
    K -->|Yes| L[Keep Attempts]
    K -->|No| M[Decrement Attempts]
    J & L & M --> N[Check Game End]
    N --> O[Send Response]
    O --> P[Update UI State]
```

**3. Game State Restoration:**

```mermaid
flowchart TD
    A([Start]) --> B{URL has imageId?}
    B -->|No| C[Show Setup]
    B -->|Yes| D[Mount Component]
    D --> E{Saved State<br/>Exists?}
    E -->|No| F[New Game]
    E -->|Yes| G[Parse State]
    G --> H{IDs Match?}
    H -->|No| I[Clear Storage]
    H -->|Yes| J{Game Finished?}
    J -->|Yes| K[Clear Storage]
    J -->|No| L[Restore State]
    I & K --> F
    L --> M[Apply Config]
    M --> N[Show Game]
```

**4. Feature Detection System:**

```mermaid
sequenceDiagram
    participant U as User
    participant C as Client
    participant S as Server
    participant AI as Gemini AI

    U->>C: Enter Description
    C->>S: POST /api/chat
    S->>AI: Analyze Input
    AI->>S: Feature Matches
    S->>S: Compare with Targets
    S->>C: Update Results
    C->>U: Show Feedback
```

**5. State Management Flow:**

```mermaid
stateDiagram-v2
    [*] --> Setup
    Setup --> Playing: New Game
    Playing --> Playing: User Input
    Playing --> EndGame: Win/Lose
    Playing --> Setup: Reset
    EndGame --> Setup: Start Over
    EndGame --> [*]: Exit
```

**6. Data Architecture Overview:**

```mermaid
graph LR
    A[Client State] --> B[Local Storage]
    A --> C[UI Components]
    D[Server APIs] --> E[Gemini AI]
    D --> A
    F[URL State] --> A
    G[Game Logic] --> A
    G --> D
```
**7. Error Handling Flow:**
```mermaid
flowchart TD
    A([Error Occurs]) --> B{Error Type?}
    B -->|API Error| C[Retry Logic]
    B -->|Network Error| D[Connection Check]
    B -->|Game Logic| E[State Recovery]

    C --> F{Retry Success?}
    F -->|Yes| G[Resume Game]
    F -->|No| H[Show Error UI]

    D --> I{Online?}
    I -->|Yes| J[Retry Operation]
    I -->|No| K[Offline Mode]

    E --> L[Save State]
    L --> M[Reset Game]
```

**8. Game Initialization Sequence:**
```mermaid
sequenceDiagram
    participant U as User
    participant C as Client
    participant R as Remix Server
    participant G as Gemini API

    U->>C: Start Game
    C->>R: Request Setup
    R->>G: Generate Image
    G-->>R: Image Data
    R->>G: Extract Features
    G-->>R: Feature List
    R-->>C: Game Config
    C->>C: Initialize State
    C-->>U: Show Game UI
```

**9. State Updates & Effects:**
```mermaid
stateDiagram-v2
    direction LR
    [*] --> Initial
    Initial --> Setup: User Input
    Setup --> Playing: Game Start
    Playing --> Paused: User Pause
    Paused --> Playing: Resume
    Playing --> GameOver: Win/Lose
    GameOver --> Initial: Restart

    state Playing {
        [*] --> WaitingInput
        WaitingInput --> Processing: Submit
        Processing --> Feedback: AI Response
        Feedback --> WaitingInput: Continue
    }
```
## 📝 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Google AI Team
- Remix Framework Team
- Tailwind CSS Team
- Open Source Contributors

## 📚 Additional Resources

- [API Documentation](docs/api.md)
- [Contributing Guide](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Change Log](CHANGELOG.md)
