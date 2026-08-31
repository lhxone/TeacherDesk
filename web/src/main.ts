import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { registerSW } from 'virtual:pwa-register';
import App from './App.vue';
import { router } from './router';
import { purgeApiCaches, setAuthFailureHandler } from './api/client';
import { syncPushSubscription } from './api/push';
import { useTheme } from './composables/useTheme';
import './styles.css';

// Applies the stored/system theme to <html data-theme> immediately (the
// composable's watchEffect runs on import), before first paint.
useTheme();

// Keep the service worker current (autoUpdate). Once it is active, refresh the
// push subscription so reminders keep reaching this device.
registerSW({
  immediate: true,
  onRegisteredSW() {
    void syncPushSubscription();
  },
});

const app = createApp(App);
app.use(createPinia());
app.use(router);

// A dead refresh token anywhere in the app returns the user to the login page.
// Purge cached API responses on the way out so the next teacher to sign in on
// this browser cannot be served the previous one's data.
setAuthFailureHandler(() => {
  void purgeApiCaches();
  router.push({ name: 'login' });
});

app.mount('#app');
