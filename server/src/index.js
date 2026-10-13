import { app } from './app.js';
import { config } from './config/env.js';
import { checkDbHealth } from './db/index.js';

async function startServer() {
  console.log('Connecting to TimescaleDB...');
  const health = await checkDbHealth();

  if (!health.connected) {
    console.error('Failed to connect to TimescaleDB:', health.error);
    console.log('Retrying in 3 seconds...');
    setTimeout(startServer, 3000);
    return;
  }

  console.log('Connected to TimescaleDB successfully!');

  const server = app.listen(config.port, () => {
    console.log(`====================================================`);
    console.log(` ValetTrack API Server running on port ${config.port}`);
    console.log(` Health: http://localhost:${config.port}/api/health`);
    console.log(` Summary: http://localhost:${config.port}/api/dashboard/summary`);
    console.log(` Environment: ${config.nodeEnv}`);
    console.log(`====================================================`);
  });

  process.on('SIGTERM', () => {
    console.log('SIGTERM received. Shutting down gracefully...');
    server.close(() => {
      console.log('Server closed.');
      process.exit(0);
    });
  });
}

startServer();
