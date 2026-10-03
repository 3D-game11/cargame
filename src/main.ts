import './style.css';
import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const game = new Game(canvas);
game.start();

if (import.meta.env.DEV) (window as unknown as { game: Game }).game = game;
