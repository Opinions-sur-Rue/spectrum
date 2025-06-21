import { useState } from 'react'

const Notifications = ({ notifications, removeNotification }) => {
  const [dismissing, setDismissing] = useState({})
  
  // Function to handle dismissal with animation
  const handleDismiss = (id) => {
    setDismissing(prev => ({ ...prev, [id]: true }))
    
    // Wait for animation to complete before actually removing
    setTimeout(() => {
      removeNotification(id)
      setDismissing(prev => {
        const newState = { ...prev }
        delete newState[id]
        return newState
      })
    }, 300)
  }
  
  // Function to get notification icon based on type
  const getNotificationIcon = (type) => {
    switch (type) {
      case 'mention':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M14.243 5.757a6 6 0 10-.986 9.284 1 1 0 111.087 1.678A8 8 0 1118 10a3 3 0 01-4.8 2.401A4 4 0 1114 10a1 1 0 102 0c0-1.537-.586-3.07-1.757-4.243zM12 10a2 2 0 10-4 0 2 2 0 004 0z" clipRule="evenodd" />
          </svg>
        )
      case 'moderation':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        )
      case 'friend-join':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 9a3 3 0 100-6 3 3 0 000 6zm-7 9a7 7 0 1114 0H3z" clipRule="evenodd" />
          </svg>
        )
      case 'undesirable-join':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-8-3a1 1 0 00-.867.5 1 1 0 11-1.731-1A3 3 0 0113 8a3.001 3.001 0 01-2 2.83V11a1 1 0 11-2 0v-1a1 1 0 011-1 1 1 0 100-2zm0 8a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
          </svg>
        )
      case 'info':
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
          </svg>
        )
      default:
        return (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
          </svg>
        )
    }
  }

  // Function to get background styling based on notification type
  const getNotificationStyling = (type) => {
    switch (type) {
      case 'mention':
        return {
          bg: 'bg-gradient-to-r from-cyan-500/90 to-blue-500/90',
          border: 'border-cyan-400/50',
          shadow: 'shadow-cyan-500/30'
        }
      case 'moderation':
        return {
          bg: 'bg-gradient-to-r from-rose-500/90 to-red-500/90',
          border: 'border-rose-400/50',
          shadow: 'shadow-rose-500/30'
        }
      case 'friend-join':
        return {
          bg: 'bg-gradient-to-r from-green-500/90 to-emerald-500/90',
          border: 'border-green-400/50',
          shadow: 'shadow-green-500/30'
        }
      case 'undesirable-join':
        return {
          bg: 'bg-gradient-to-r from-orange-500/90 to-amber-500/90',
          border: 'border-orange-400/50',
          shadow: 'shadow-orange-500/30'
        }
      case 'info':
        return {
          bg: 'bg-gradient-to-r from-blue-500/90 to-indigo-500/90',
          border: 'border-blue-400/50',
          shadow: 'shadow-blue-500/30'
        }
      default:
        return {
          bg: 'bg-gradient-to-r from-gray-700/90 to-gray-800/90',
          border: 'border-gray-600/50',
          shadow: 'shadow-gray-500/30'
        }
    }
  }

  return (
    <div className="fixed top-4 right-4 w-[350px] max-w-[90vw] z-[1000] flex flex-col gap-3 pointer-events-none">
      {notifications.map(notification => {
        const styling = getNotificationStyling(notification.type)
        return (
          <div 
            key={notification.id} 
            className={`
              p-4 rounded-xl border ${styling.border} ${styling.bg} backdrop-blur-sm 
              text-white shadow-lg ${styling.shadow}
              transform transition-all duration-300 ease-in-out pointer-events-auto
              ${dismissing[notification.id] ? 'opacity-0 translate-x-full' : 'opacity-100'}
            `}
          >
            <button 
              className="absolute top-3 right-3 text-white/70 hover:text-white focus:outline-none transition-colors"
              onClick={() => handleDismiss(notification.id)}
              aria-label="Close notification"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
            
            <div className="flex items-start gap-3">
              <div className="rounded-full p-2 bg-white/20 flex-shrink-0 mt-0.5">
                {getNotificationIcon(notification.type)}
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="font-bold text-white mb-1 pr-6">
                  {notification.title}
                </div>
                <div className="text-white/90 text-sm break-words">{notification.message}</div>
                
                {notification.reason && (
                  <div className="mt-2 px-3 py-2 bg-black/20 rounded-lg text-xs text-white/80 font-medium">
                    Reason: {notification.reason}
                  </div>
                )}
                
                <div className="mt-2 text-xs text-white/60">
                  {new Date(notification.timestamp).toLocaleTimeString()}
                </div>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default Notifications 