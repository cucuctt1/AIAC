import { defineConfig, UserConfig, ConfigEnv } from 'vite';
import path from 'path';

export default defineConfig((env: ConfigEnv): UserConfig => {
  let common: UserConfig = {
    server: {
      port: 5000,
    },
    root: './',
    base: './',
    publicDir: './public',
    resolve: {
      extensions: ['.ts', '.js'],
      alias: {
        '@framework': path.resolve(__dirname, '../vendor/cubism/Framework/src'),
      }
    },
    build: {
      target: 'es2022',
      assetsDir: 'assets',
      outDir: './dist',
      emptyOutDir: true,
      sourcemap: env.mode == 'development' ? true : false,
    },
  };
  return common;
});
