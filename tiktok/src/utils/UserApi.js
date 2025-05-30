// API utilities for user management (friends, undesirables)
const API_BASE_URL = window.location.hostname === 'localhost' 
    ? 'http://localhost:8081/api' 
    : '/api';

/**
 * Transform snake_case database fields to camelCase
 * @param {Object} item - The item with snake_case fields
 * @returns {Object} - The item with camelCase fields
 */
const transformUserData = (item) => {
  return {
    id: item.id,
    uniqueId: item.uniqueId || item.unique_id, // TikTok username (handle both camelCase and snake_case)
    userId: item.userId || item.user_id, // TikTok numeric ID
    tiktokId: item.uniqueId || item.unique_id, // Keep for backward compatibility
    nickname: item.nickname,
    profilePictureUrl: item.profilePictureUrl || item.profile_picture_url,
    firstSeen: item.first_seen,
    lastSeen: item.last_seen,
    addedAt: item.added_at,
    reason: item.reason || '', // Only for undesirables
    // Add additional fields as needed
  };
};

/**
 * Search for users in the database
 * @param {string} query - The search query
 * @returns {Promise<Array>} - The search results
 */
export const searchUsers = async (query) => {
  try {
    const response = await fetch(`${API_BASE_URL}/users/search?query=${encodeURIComponent(query)}`);
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    const results = await response.json();
    // No transformation needed for search results since they're directly used with the db field names
    return results;
  } catch (error) {
    console.error('Error searching users:', error);
    throw error;
  }
};

/**
 * Load all user lists (friends and undesirables)
 * @returns {Promise<Object>} - Object containing friendsList and undesirablesList
 */
export const loadUserLists = async () => {
  try {
    // Get friends and undesirables in parallel
    const [friendsResponse, undesirableResponse] = await Promise.all([
      fetch(`${API_BASE_URL}/users/friends`),
      fetch(`${API_BASE_URL}/users/undesirables`)
    ]);
    
    if (!friendsResponse.ok) {
      throw new Error(`HTTP error loading friends: ${friendsResponse.status}`);
    }
    
    if (!undesirableResponse.ok) {
      throw new Error(`HTTP error loading undesirables: ${undesirableResponse.status}`);
    }
    
    // These responses are direct arrays from the server
    const friendsData = await friendsResponse.json();
    const undesirableData = await undesirableResponse.json();
    
    // Transform the data to match frontend expected schema
    const friends = friendsData.map(transformUserData);
    const undesirables = undesirableData.map(transformUserData);
    
    return {
      friendsList: friends,
      undesirablesList: undesirables
    };
  } catch (error) {
    console.error('Error loading user lists:', error);
    throw error;
  }
};

/**
 * Add a user to the friends list and fetch the updated list
 * @param {string} uniqueId - The TikTok username of the user
 * @param {string} nickname - The nickname of the user
 * @param {string} profilePictureUrl - The profile picture URL of the user (optional)
 * @returns {Promise<Array>} - The updated friends list
 */
export const addToFriendsList = async (user) => {
  try {
    // For backward compatibility, also use uniqueId as userId if we don't have it
    
    
    // Add the friend
    const response = await fetch(`${API_BASE_URL}/users/friends`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ uniqueId:user.uniqueId, userId:user.userId || user.uniqueId, nickname:user.nickname, profilePictureUrl:user.profilePictureUrl }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    // After adding successfully, fetch the updated list
    const updatedListResponse = await fetch(`${API_BASE_URL}/users/friends`);
    if (!updatedListResponse.ok) {
      throw new Error(`HTTP error: ${updatedListResponse.status}`);
    }
    
    const friendsData = await updatedListResponse.json();
    // Transform the data to match frontend expected schema
    return friendsData.map(transformUserData);
  } catch (error) {
    console.error('Error adding friend:', error);
    throw error;
  }
};

/**
 * Remove a user from the friends list and fetch the updated list
 * @param {string} uniqueId - The TikTok username of the user
 * @returns {Promise<Array>} - The updated friends list
 */
export const removeFriend = async (uniqueId) => {
  try {
    // Remove the friend
    const response = await fetch(`${API_BASE_URL}/users/friends/${uniqueId}`, {
      method: 'DELETE',
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    // After removing successfully, fetch the updated list
    const updatedListResponse = await fetch(`${API_BASE_URL}/users/friends`);
    if (!updatedListResponse.ok) {
      throw new Error(`HTTP error: ${updatedListResponse.status}`);
    }
    
    const friendsData = await updatedListResponse.json();
    // Transform the data to match frontend expected schema
    return friendsData.map(transformUserData);
  } catch (error) {
    console.error('Error removing friend:', error);
    throw error;
  }
};

/**
 * Add a user to the undesirables list and fetch the updated list
 * @param {string} uniqueId - The TikTok username of the user
 * @param {string} nickname - The nickname of the user
 * @param {string} reason - The reason for adding to undesirables
 * @param {string} profilePictureUrl - The profile picture URL of the user (optional)
 * @returns {Promise<Array>} - The updated undesirables list
 */
export const addToUndesirablesList = async (theUser, reason = '') => {
  try {
    // For backward compatibility, also use uniqueId as userId if we don't have it
    if(reason === ""){
      // Don't show a prompt here - the component should display a modal to collect this
      throw new Error("A reason is required for adding to undesirables list");
    }

    
    // Add the undesirable
    const response = await fetch(`${API_BASE_URL}/users/undesirables`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ 
        uniqueId: theUser.uniqueId, 
        userId: theUser.userId || theUser.uniqueId, 
        nickname: theUser.nickname, 
        reason, 
        profilePictureUrl: theUser.profilePictureUrl 
      }),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    // After adding successfully, fetch the updated list
    const updatedListResponse = await fetch(`${API_BASE_URL}/users/undesirables`);
    if (!updatedListResponse.ok) {
      throw new Error(`HTTP error: ${updatedListResponse.status}`);
    }
    
    const undesirableData = await updatedListResponse.json();
    // Transform the data to match frontend expected schema
    return undesirableData.map(transformUserData);
  } catch (error) {
    console.error('Error adding undesirable:', error);
    throw error;
  }
};

/**
 * Remove a user from the undesirables list and fetch the updated list
 * @param {string} uniqueId - The TikTok username of the user
 * @returns {Promise<Array>} - The updated undesirables list
 */
export const removeUndesirable = async (uniqueId) => {
  try {
    // Remove the undesirable
    const response = await fetch(`${API_BASE_URL}/users/undesirables/${uniqueId}`, {
      method: 'DELETE',
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    // After removing successfully, fetch the updated list
    const updatedListResponse = await fetch(`${API_BASE_URL}/users/undesirables`);
    if (!updatedListResponse.ok) {
      throw new Error(`HTTP error: ${updatedListResponse.status}`);
    }
    
    const undesirableData = await updatedListResponse.json();
    // Transform the data to match frontend expected schema
    return undesirableData.map(transformUserData);
  } catch (error) {
    console.error('Error removing undesirable:', error);
    throw error;
  }
};

/**
 * Get user preferences including theme
 * @returns {Promise<Object>} - The user preferences
 */
export const getUserPreferences = async () => {
  try {
    const response = await fetch(`${API_BASE_URL}/preferences`);
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.error('Error getting user preferences:', error);
    throw error;
  }
};

/**
 * Save user preferences including theme
 * @param {Object} preferences - The preferences object to save
 * @returns {Promise<Object>} - The updated preferences
 */
export const saveUserPreferences = async (preferences) => {
  try {
    const response = await fetch(`${API_BASE_URL}/preferences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(preferences),
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error saving user preferences:', error);
    throw error;
  }
}; 