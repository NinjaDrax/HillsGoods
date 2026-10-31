// Hillsgoods API client starter.
// Load this file after setting API_BASE to your deployed backend URL.
// Never place MongoDB credentials or SETUP_SECRET in frontend code.
window.HillsgoodsAPI = (() => {
  const API_BASE = "https://YOUR-BACKEND.onrender.com";
  const tokenKey = "hillsgoods_session_token";

  function token() { return sessionStorage.getItem(tokenKey); }
  function setToken(value) { sessionStorage.setItem(tokenKey, value); }
  function signOut() { sessionStorage.removeItem(tokenKey); }

  async function request(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const response = await fetch(`${API_BASE}${path}`, { ...options, headers });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }

  return {
    login: async (email, password) => {
      const data = await request("/api/login", { method: "POST", body: JSON.stringify({ email, password }) });
      setToken(data.token);
      return data.user;
    },
    logout: signOut,
    getProducts: () => request("/api/products"),
    addProduct: product => request("/api/products", { method: "POST", body: JSON.stringify(product) }),
    updateProduct: (id, changes) => request(`/api/products/${id}`, { method: "PATCH", body: JSON.stringify(changes) }),
    archiveProduct: id => request(`/api/products/${id}`, { method: "DELETE" }),
    getTransactions: (filters = {}) => {
      const params = new URLSearchParams(filters);
      return request(`/api/transactions${params.size ? `?${params}` : ""}`);
    },
    addTransaction: transaction => request("/api/transactions", { method: "POST", body: JSON.stringify(transaction) }),
    getSummary: () => request("/api/summary"),
    health: () => fetch(`${API_BASE}/api/health`).then(r => r.json())
  };
})();
