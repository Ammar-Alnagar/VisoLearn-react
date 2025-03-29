export interface ImageData {
  id: number;
  url: string;
  alt: string;
  features: string[]; // Key descriptive features for the game
  difficulty: 'easy' | 'medium' | 'hard';
}

// Sample image data - replace with your actual images and features
export const images: ImageData[] = [
  {
    id: 1,
    url: 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?q=80&w=1974&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    alt: 'A happy dog with a red collar',
    features: ['dog', 'brown and white fur', 'red collar', 'tongue out', 'grass background'],
    difficulty: 'easy',
  },
  {
    id: 2,
    url: 'https://images.unsplash.com/photo-1503614472-8c93d56e92ce?q=80&w=2011&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    alt: 'Mountain landscape with a lake',
    features: ['mountains', 'snow-capped peaks', 'clear blue lake', 'reflection in water', 'pine trees'],
    difficulty: 'medium',
  },
  {
    id: 3,
    url: 'https://images.unsplash.com/photo-1472851294608-062f824d29cc?q=80&w=2070&auto=format&fit=crop&ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8fA%3D%3D',
    alt: 'Busy marketplace scene',
    features: ['crowded street', 'market stalls', 'various goods displayed', 'people shopping', 'colorful fabrics'],
    difficulty: 'hard',
  },
];

export function getImageByDifficulty(difficulty: 'easy' | 'medium' | 'hard'): ImageData | undefined {
    const suitableImages = images.filter(img => img.difficulty === difficulty);
    if (suitableImages.length === 0) {
        // Fallback if no image matches difficulty
        return images[0];
    }
    // Return a random image from the suitable ones
    return suitableImages[Math.floor(Math.random() * suitableImages.length)];
}
