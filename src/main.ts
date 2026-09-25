import Phaser from 'phaser';
import { Boot } from './render/scenes/Boot';
import { Game } from './render/scenes/Game';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  width: 1280,
  height: 720,
  backgroundColor: '#1d1f21',
  scene: [Boot, Game],
};

new Phaser.Game(config);
