import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router';
import { purgeApiCaches, setAuthFailureHandler } from './api/client';
import './styles.css';

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
