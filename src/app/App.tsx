import React, { useState, useEffect, useRef } from 'react';
import { Menu, MapPin, Search, Navigation, ArrowDownUp, X, Circle, Square, Clock, ChevronLeft, Home, Briefcase } from 'lucide-react';
import { motion, AnimatePresence, useDragControls, useMotionValue } from 'motion/react';

export default function App() {
  const constraintsRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const dragControls = useDragControls();
  
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  
  const userTargetPos = useRef({ x: 0, y: 0 });
  const isDragging = useRef(false);

  const [focusedInput, setFocusedInput] = useState<'pickup' | 'dropoff' | null>(null);
  const [pickup, setPickup] = useState('');
  const [dropoff, setDropoff] = useState('');
  
  // New State for Home/Work feature
  const [savedLocations, setSavedLocations] = useState({ home: '', work: '' });
  const [setupModal, setSetupModal] = useState<'home' | 'work' | null>(null);
  const [setupAddress, setSetupAddress] = useState('');
  const [targetInput, setTargetInput] = useState<'pickup' | 'dropoff' | 'menu'>('dropoff');
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  // Handle mobile full-screen mode when focused
  const isMobileFocused = focusedInput !== null;

  // Automatically keep box within bounds on layout changes
  useEffect(() => {
    let isRunning = true;
    let frameId: number;
    
    const loop = () => {
      if (!isRunning) return;
      
      if (boxRef.current && constraintsRef.current && !isDragging.current) {
        const box = boxRef.current.getBoundingClientRect();
        const bounds = constraintsRef.current.getBoundingClientRect();
        
        const currentY = y.get();
        const currentX = x.get();
        
        // Calculate the "native" position without the current transform
        const nativeTop = box.top - currentY;
        const nativeBottom = box.bottom - currentY;
        const nativeLeft = box.left - currentX;
        const nativeRight = box.right - currentX;
        
        let desiredY = userTargetPos.current.y;
        let desiredX = userTargetPos.current.x;
        
        // Keep within vertical bounds
        if (nativeBottom - nativeTop <= bounds.height + 1) {
          if (nativeBottom + desiredY > bounds.bottom) {
            desiredY = bounds.bottom - nativeBottom;
          }
          if (nativeTop + desiredY < bounds.top) {
            desiredY = bounds.top - nativeTop;
          }
        } else {
          desiredY = bounds.top - nativeTop; // Pin to top if taller than screen
        }
        
        // Keep within horizontal bounds
        if (nativeRight - nativeLeft <= bounds.width + 1) {
          if (nativeRight + desiredX > bounds.right) {
            desiredX = bounds.right - nativeRight;
          }
          if (nativeLeft + desiredX < bounds.left) {
            desiredX = bounds.left - nativeLeft;
          }
        } else {
          desiredX = bounds.left - nativeLeft;
        }
        
        // Use set() for immediate, un-animated updates since this runs every frame during the layout transition
        if (currentY !== desiredY) y.set(desiredY);
        if (currentX !== desiredX) x.set(desiredX);
      }
      
      frameId = requestAnimationFrame(loop);
    };
    
    loop();
    
    // Give the layout transition 0.5s to fully finish expanding/shrinking
    const timer = setTimeout(() => {
      isRunning = false;
      cancelAnimationFrame(frameId);
    }, 500); 
    
    return () => {
      isRunning = false;
      cancelAnimationFrame(frameId);
      clearTimeout(timer);
    };
  }, [focusedInput, isMenuOpen, setupModal, pickup, dropoff]);

  const handleLocationSelect = (type: 'home' | 'work') => {
    const currentTarget = focusedInput || 'dropoff';
    if (savedLocations[type]) {
      if (currentTarget === 'pickup') {
        setPickup(savedLocations[type]);
      } else {
        setDropoff(savedLocations[type]);
      }
      setFocusedInput(null);
    } else {
      setTargetInput(currentTarget);
      setSetupAddress('');
      setSetupModal(type);
    }
  };

  return (
    <div ref={constraintsRef} className="relative w-full h-screen overflow-hidden bg-[#e5e3df]">
      {/* Background Map Mock */}
      <div className="absolute inset-0 z-0">
        <img 
          src="https://images.unsplash.com/photo-1604357209793-fca5dca89f97?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxnb29nbGUlMjBtYXBzJTIwbmF2aWdhdGlvbiUyMHJvdXRlfGVufDF8fHx8MTc3OTE2MzA1OXww&ixlib=rb-4.1.0&q=80&w=1080"
          alt="Map"
          className="w-full h-full object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-black/5" />
      </div>

      {/* Floating UI Container */}
      <div className="absolute inset-0 z-10 pointer-events-none">
        <motion.div 
          layout
          ref={boxRef}
          style={{ x, y }}
          drag
          dragConstraints={constraintsRef}
          dragControls={dragControls}
          dragListener={false}
          dragMomentum={false}
          dragElastic={0.2}
          dragTransition={{ bounceStiffness: 400, bounceDamping: 25 }}
          onDragStart={() => { isDragging.current = true; }}
          onDragEnd={() => { 
            isDragging.current = false; 
            userTargetPos.current = { x: x.get(), y: y.get() }; 
          }}
          transition={{ type: "spring", bounce: 0, duration: 0.3 }}
          className={`bg-white pointer-events-auto shadow-2xl flex flex-col overflow-hidden absolute
            ${isMobileFocused 
              ? 'inset-0 md:inset-auto md:top-8 md:left-8 md:w-[400px] h-full md:h-auto md:max-h-[85vh] md:rounded-3xl' 
              : 'bottom-0 md:bottom-auto md:top-8 left-0 md:left-8 w-full md:w-[400px] h-auto mt-auto md:mt-0 rounded-t-3xl md:rounded-3xl max-h-[85vh]'
            }
          `}
        >
          {/* Header */}
          <motion.div layout transition={{ type: "spring", bounce: 0, duration: 0.3 }} className={`flex items-center justify-between px-4 py-3 md:pt-5 border-b border-gray-100 relative ${isMobileFocused ? 'bg-white' : ''}`}>
            {isMobileFocused ? (
              <button 
                onClick={() => { setFocusedInput(null); setIsMenuOpen(false); }}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors z-10"
              >
                <ChevronLeft size={24} />
              </button>
            ) : isMenuOpen ? (
              <button 
                onClick={() => setIsMenuOpen(false)}
                className="p-2 hover:bg-gray-100 rounded-full transition-colors z-10"
              >
                <ChevronLeft size={24} />
              </button>
            ) : (
              <button onClick={() => setIsMenuOpen(true)} className="p-2 hover:bg-gray-100 rounded-full transition-colors z-10">
                <Menu size={24} />
              </button>
            )}
            
            {/* Universal Drag Indicator */}
            <div 
              className="absolute left-1/2 -translate-x-1/2 top-0 pt-3 pb-3 px-8 cursor-grab active:cursor-grabbing touch-none z-10"
              onPointerDown={(e) => dragControls.start(e)}
            >
              <div className="w-12 h-1.5 bg-gray-300 rounded-full hover:bg-gray-400 transition-colors" />
            </div>
          </motion.div>

          {/* Main Content */}
          <motion.div layout transition={{ type: "spring", bounce: 0, duration: 0.3 }} className="flex-1 overflow-y-auto bg-white flex flex-col relative overflow-hidden">
            <AnimatePresence mode="popLayout" initial={false}>
            {isMenuOpen ? (
              <motion.div 
                layout
                key="settings"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                transition={{ layout: { type: "spring", bounce: 0, duration: 0.3 }, duration: 0.2 }}
                className="flex flex-col h-full w-full"
              >
                <div className="p-5 flex-shrink-0">
                  <h1 className="text-2xl font-bold mb-6 hidden md:block">Settings</h1>
                  
                  {/* Settings / Saved Places */}
                  <div className="space-y-6">
                    <div>
                      <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Saved Places</h3>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between group">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600">
                              <Home size={18} />
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900">Home</div>
                              <div className="text-xs text-gray-500 truncate max-w-[120px]">{savedLocations.home || 'Not set'}</div>
                            </div>
                          </div>
                          <button 
                            onClick={() => {
                              setTargetInput('menu');
                              setSetupAddress(savedLocations.home || '');
                              setSetupModal('home');
                            }}
                            className="text-sm text-blue-600 font-semibold px-3 py-1.5 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            {savedLocations.home ? 'Edit' : 'Add'}
                          </button>
                        </div>

                        <div className="flex items-center justify-between group">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600">
                              <Briefcase size={18} />
                            </div>
                            <div>
                              <div className="font-semibold text-gray-900">Work</div>
                              <div className="text-xs text-gray-500 truncate max-w-[120px]">{savedLocations.work || 'Not set'}</div>
                            </div>
                          </div>
                          <button 
                            onClick={() => {
                              setTargetInput('menu');
                              setSetupAddress(savedLocations.work || '');
                              setSetupModal('work');
                            }}
                            className="text-sm text-blue-600 font-semibold px-3 py-1.5 hover:bg-blue-50 rounded-lg transition-colors"
                          >
                            {savedLocations.work ? 'Edit' : 'Add'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div 
                layout
                key="request"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 20 }}
                transition={{ layout: { type: "spring", bounce: 0, duration: 0.3 }, duration: 0.2 }}
                className="flex flex-col h-full w-full"
              >
                {/* Ride Request Form */}
                <div className="p-5 flex-shrink-0">
                  {!isMobileFocused && <h1 className="text-2xl font-bold mb-6 hidden md:block">Request a ride</h1>}
              
              <div className="relative">
                {/* Connecting Line */}
                <div className="absolute left-[23px] top-[26px] bottom-[26px] w-[2px] bg-gray-300 z-0"></div>
                
                <div className="space-y-3 relative z-10">
                  {/* Pickup Input */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-5">
                      <div className="w-2 h-2 rounded-full bg-black"></div>
                    </div>
                    <div className={`flex-1 bg-gray-100 rounded-xl flex items-center px-4 transition-all duration-200 ${focusedInput === 'pickup' ? 'bg-white ring-2 ring-black shadow-sm' : 'hover:bg-gray-200'}`}>
                      <input 
                        type="text" 
                        placeholder="Pickup location" 
                        value={pickup}
                        onChange={(e) => setPickup(e.target.value)}
                        className="w-full bg-transparent py-3.5 text-base font-medium focus:outline-none placeholder:text-gray-500 text-black"
                        onFocus={() => setFocusedInput('pickup')}
                      />
                      {pickup && (
                        <button onClick={() => setPickup('')} className="p-1 text-gray-400 hover:text-black rounded-full">
                          <X size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                  
                  {/* Dropoff Input */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center justify-center w-5">
                      <div className="w-2 h-2 bg-black"></div>
                    </div>
                    <div className={`flex-1 bg-gray-100 rounded-xl flex items-center px-4 transition-all duration-200 ${focusedInput === 'dropoff' ? 'bg-white ring-2 ring-black shadow-sm' : 'hover:bg-gray-200'}`}>
                      <input 
                        type="text" 
                        placeholder="Where to?" 
                        value={dropoff}
                        onChange={(e) => setDropoff(e.target.value)}
                        className="w-full bg-transparent py-3.5 text-base font-medium focus:outline-none placeholder:text-gray-500 text-black"
                        onFocus={() => setFocusedInput('dropoff')}
                      />
                      {dropoff && (
                        <button onClick={() => setDropoff('')} className="p-1 text-gray-400 hover:text-black rounded-full">
                          <X size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Swap Button */}
                <button 
                  onClick={() => {
                    const temp = pickup;
                    setPickup(dropoff);
                    setDropoff(temp);
                  }}
                  className="absolute right-4 top-1/2 -translate-y-1/2 bg-gray-100 p-2 rounded-full hover:bg-gray-200 shadow-sm border border-gray-200 z-20 transition-transform active:scale-95"
                  aria-label="Swap locations"
                >
                  <ArrowDownUp size={16} className="text-gray-600" />
                </button>
              </div>

              {/* Autocomplete / Suggestions */}
              <div className="mt-6">
                {focusedInput ? (
                  <div className="space-y-1 animate-in fade-in slide-in-from-bottom-2 duration-200">
                    {/* Current Location Option */}
                    {focusedInput === 'pickup' && (
                      <div className="flex items-center gap-4 cursor-pointer hover:bg-gray-50 p-3 -mx-3 rounded-xl transition-colors">
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 shrink-0">
                          <Navigation size={20} className="fill-current" />
                        </div>
                        <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                          <div className="font-semibold text-gray-900 text-base">Current Location</div>
                        </div>
                      </div>
                    )}

                    {/* Home Option */}
                    <div className="flex items-center gap-4 cursor-pointer hover:bg-gray-50 p-3 -mx-3 rounded-xl transition-colors" onClick={() => handleLocationSelect('home')}>
                      <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 shrink-0">
                        <Home size={20} />
                      </div>
                      <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                        <div className="font-semibold text-gray-900 text-base">Home</div>
                        <div className="text-sm text-gray-500 mt-0.5">{savedLocations.home || 'Set location'}</div>
                      </div>
                    </div>
                    
                    {/* Work Option */}
                    <div className="flex items-center gap-4 cursor-pointer hover:bg-gray-50 p-3 -mx-3 rounded-xl transition-colors" onClick={() => handleLocationSelect('work')}>
                      <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 shrink-0">
                        <Briefcase size={20} />
                      </div>
                      <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                        <div className="font-semibold text-gray-900 text-base">Work</div>
                        <div className="text-sm text-gray-500 mt-0.5">{savedLocations.work || 'Set location'}</div>
                      </div>
                    </div>
                    
                    {/* Recent & Suggested Places */}
                    <div className="flex items-center gap-4 cursor-pointer hover:bg-gray-50 p-3 -mx-3 rounded-xl transition-colors">
                      <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 shrink-0">
                        <Clock size={20} />
                      </div>
                      <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                        <div className="font-semibold text-gray-900 text-base">San Francisco International Airport</div>
                        <div className="text-sm text-gray-500 mt-0.5">San Francisco, CA</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 cursor-pointer hover:bg-gray-50 p-3 -mx-3 rounded-xl transition-colors">
                      <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 shrink-0">
                        <MapPin size={20} />
                      </div>
                      <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                        <div className="font-semibold text-gray-900 text-base">Salesforce Tower</div>
                        <div className="text-sm text-gray-500 mt-0.5">415 Mission St, San Francisco, CA</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-4 cursor-pointer hover:bg-gray-50 p-3 -mx-3 rounded-xl transition-colors">
                      <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center text-gray-600 shrink-0">
                        <MapPin size={20} />
                      </div>
                      <div className="flex-1 border-b border-gray-100 pb-4 mt-4">
                        <div className="font-semibold text-gray-900 text-base">Golden Gate Bridge</div>
                        <div className="text-sm text-gray-500 mt-0.5">Golden Gate Bridge, San Francisco, CA</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4 animate-in fade-in duration-300">
                    <div className="flex gap-4">
                      <button onClick={() => handleLocationSelect('home')} className="flex-1 bg-gray-100 hover:bg-gray-200 py-3.5 rounded-xl flex items-center justify-center gap-2.5 font-semibold text-sm transition-colors text-gray-800">
                        <div className="w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-sm">
                          <Home size={14} className="text-black" />
                        </div>
                        Home
                      </button>
                      <button onClick={() => handleLocationSelect('work')} className="flex-1 bg-gray-100 hover:bg-gray-200 py-3.5 rounded-xl flex items-center justify-center gap-2.5 font-semibold text-sm transition-colors text-gray-800">
                        <div className="w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-sm">
                          <Briefcase size={14} className="text-black" />
                        </div>
                        Work
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
            
            {/* Fill space in mobile if not enough content */}
            {isMobileFocused && <div className="flex-1 bg-gray-50/50"></div>}
            </motion.div>
            )}
            </AnimatePresence>
          </motion.div>

          {/* Footer Actions */}
          <AnimatePresence mode="popLayout">
          {!focusedInput && !isMenuOpen && (
            <motion.div 
              layout
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ layout: { type: "spring", bounce: 0, duration: 0.3 }, duration: 0.2 }}
              className="p-5 bg-white border-t border-gray-100 rounded-b-3xl w-full"
            >
              <button className="w-full bg-black text-white py-4 rounded-xl font-bold text-lg hover:bg-gray-800 transition-colors shadow-lg active:scale-[0.98]">
                Search rides
              </button>
            </motion.div>
          )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* Location Setup Modal */}
      {setupModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm transition-opacity">
          <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl animate-in fade-in zoom-in-95 duration-200">
            <h2 className="text-xl font-bold mb-2">Set {setupModal === 'home' ? 'Home' : 'Work'} address</h2>
            <p className="text-gray-500 text-sm mb-6">Enter a valid address to save it for future rides.</p>
            
            <input
              type="text"
              autoFocus
              placeholder={`Enter ${setupModal} address`}
              value={setupAddress}
              onChange={(e) => setSetupAddress(e.target.value)}
              className="w-full bg-gray-100 rounded-xl px-4 py-3.5 text-base font-medium focus:outline-none focus:ring-2 focus:ring-black mb-6 text-black placeholder:text-gray-500"
            />
            
            <div className="flex gap-3">
              <button
                onClick={() => setSetupModal(null)}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-800 rounded-xl font-semibold transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (setupAddress.trim()) {
                    setSavedLocations(prev => ({ ...prev, [setupModal]: setupAddress }));
                    if (targetInput === 'pickup') {
                      setPickup(setupAddress);
                    } else if (targetInput === 'dropoff') {
                      setDropoff(setupAddress);
                    }
                    setSetupModal(null);
                    if (targetInput !== 'menu') {
                      setFocusedInput(null);
                    }
                  }
                }}
                className="flex-1 py-3 bg-black hover:bg-gray-800 text-white rounded-xl font-semibold transition-colors"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}