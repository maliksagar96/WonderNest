(() => {
  'use strict';
  const channel = 'BroadcastChannel' in window ? new BroadcastChannel('wonderNest-db') : null;
  async function request(path, options) {
    const response = await fetch(`/api/${path}`, { cache:'no-store', ...options, headers:{ 'Content-Type':'application/json', ...(options?.headers || {}) } });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Local database request failed (${response.status}).`);
    return result;
  }
  window.WonderNestDB = {
    get: (store) => request(store),
    set: async (store, value) => {
      const result = await request(store, { method:'PUT', body:JSON.stringify(value) });
      channel?.postMessage({ store });
      window.dispatchEvent(new CustomEvent('wonderNest:database-change', { detail:{ store } }));
      return result;
    },
    importLegacy: (value) => request('import-legacy', { method:'POST', body:JSON.stringify(value) }),
    prepareProduct: async (recipeId, quantity, color = '') => {
      const result = await request('prepare-product', { method:'POST', body:JSON.stringify({recipeId,quantity,color}) });
      channel?.postMessage({ store:'stock' });
      channel?.postMessage({ store:'prepared_items' });
      window.dispatchEvent(new CustomEvent('wonderNest:database-change', { detail:{ store:'stock' } }));
      window.dispatchEvent(new CustomEvent('wonderNest:database-change', { detail:{ store:'prepared_items' } }));
      return result;
    },
    updatePreparedItem: async (preparedItemId, recipeId, quantity, color) => {
      const result = await request('update-prepared-item', { method:'POST', body:JSON.stringify({preparedItemId,recipeId,quantity,color}) });
      channel?.postMessage({ store:'stock' });
      channel?.postMessage({ store:'prepared_items' });
      window.dispatchEvent(new CustomEvent('wonderNest:database-change', { detail:{ store:'stock' } }));
      window.dispatchEvent(new CustomEvent('wonderNest:database-change', { detail:{ store:'prepared_items' } }));
      return result;
    },
    restorePreparedItem: async (preparedItemId) => {
      const result = await request('restore-prepared-item', { method:'POST', body:JSON.stringify({preparedItemId}) });
      channel?.postMessage({ store:'stock' });
      channel?.postMessage({ store:'prepared_items' });
      window.dispatchEvent(new CustomEvent('wonderNest:database-change', { detail:{ store:'stock' } }));
      window.dispatchEvent(new CustomEvent('wonderNest:database-change', { detail:{ store:'prepared_items' } }));
      return result;
    },
    status: () => request('status'),
    subscribe: (listener) => {
      const onMessage = (event) => listener(event.data);
      const onLocalChange = (event) => listener(event.detail);
      if (channel) channel.addEventListener('message', onMessage);
      window.addEventListener('wonderNest:database-change', onLocalChange);
      return () => {
        if (channel) channel.removeEventListener('message', onMessage);
        window.removeEventListener('wonderNest:database-change', onLocalChange);
      };
    }
  };
})();
