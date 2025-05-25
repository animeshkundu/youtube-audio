module.exports = {
  verbose: true,
  testEnvironment: 'jsdom', // Or 'node' if you don't need DOM access for global.js
  setupFilesAfterEnv: ['./jest.setup.js'], // Path to your setup file
};
