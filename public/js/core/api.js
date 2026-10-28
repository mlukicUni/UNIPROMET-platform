/**
 * UNIPROMET ADMIN - Core API Client
 * Centralized fetch and error-handling utilities
 */

export async function apiRequest(endpoint, options = {}) {
  const url = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const defaultHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...(options.headers || {})
    }
  };

  if (config.body && typeof config.body === 'object' && !(config.body instanceof FormData)) {
    config.body = JSON.stringify(config.body);
  }

  try {
    const response = await fetch(url, config);
    if (!response.ok) {
      let errorData;
      try {
        errorData = await response.json();
      } catch (e) {
        errorData = { error: response.statusText };
      }
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`[API Error] ${options.method || 'GET'} ${url}:`, error);
    throw error;
  }
}

// Cameras Inventory API
export async function getCamerasInventory() {
  return await apiRequest('/api/inventory/cameras');
}

export async function createCameraInventory(cameraData) {
  return await apiRequest('/api/inventory/cameras', {
    method: 'POST',
    body: cameraData
  });
}

export async function updateCameraInventory(id, updates) {
  return await apiRequest(`/api/inventory/cameras/${id}`, {
    method: 'PUT',
    body: updates
  });
}

export async function deleteCameraInventory(id) {
  return await apiRequest(`/api/inventory/cameras/${id}`, {
    method: 'DELETE'
  });
}

// Recorders Inventory API
export async function getRecordersInventory() {
  return await apiRequest('/api/inventory/recorders');
}

export async function createRecorderInventory(recorderData) {
  return await apiRequest('/api/inventory/recorders', {
    method: 'POST',
    body: recorderData
  });
}

export async function updateRecorderInventory(id, updates) {
  return await apiRequest(`/api/inventory/recorders/${id}`, {
    method: 'PUT',
    body: updates
  });
}

export async function deleteRecorderInventory(id) {
  return await apiRequest(`/api/inventory/recorders/${id}`, {
    method: 'DELETE'
  });
}

// Printers API
export async function getPrinters(force = false) {
  return await apiRequest(`/api/printers${force ? '?force=true' : ''}`);
}

export async function scanPrinters() {
  return await apiRequest('/api/printers/scan', { method: 'POST' });
}
