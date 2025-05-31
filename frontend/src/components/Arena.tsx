'use client';

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

// Create socket instance outside component
let socket: Socket | null = null;

interface Knife {
  x: number;
  y: number;
  dx: number;
  dy: number;
  id: string;
  shooterId: string;
}

interface SpawnSlot {
  occupied: boolean;
  playerId: string | null;
}

interface SpawnSlots {
  top: SpawnSlot;
  bottom: SpawnSlot;
}

interface Player {
  x: number;
  y: number;
  radius: number;
}

export default function GameCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const knivesRef = useRef<Knife[]>([]);
  const playerRef = useRef<Player | null>(null);
  const mouseRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const playersRef = useRef<{ [id: string]: { x: number; y: number } }>({});
  const pointsRef = useRef<number>(0);
  const [myId, setMyId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [canFire, setCanFire] = useState(true);
  const [reloadText, setReloadText] = useState("Fire");
  const [isReloading, setIsReloading] = useState(false);
  const [hasSpawned, setHasSpawned] = useState(false);
  const reloadTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastMoveTimeRef = useRef<number>(0);
  const MOVE_UPDATE_INTERVAL = 50;
  const [spawnSlots, setSpawnSlots] = useState<SpawnSlots>({
    top: { occupied: false, playerId: null },
    bottom: { occupied: false, playerId: null }
  });
  const [gameTimer, setGameTimer] = useState<number | null>(null);
  const [gameEndScores, setGameEndScores] = useState<{ [id: string]: number } | null>(null);

  // Debug effect to log state changes
  useEffect(() => {
    console.log('State changed:', { canFire, reloadText, isReloading });
  }, [canFire, reloadText, isReloading]);

  // Initialize socket connection
  useEffect(() => {
    if (!socket) {
      console.log('Creating new socket connection...');
      socket = io('http://localhost:3001', {
        transports: ['polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        timeout: 10000,
        forceNew: true
      });

      socket.on('connect', () => {
        console.log('Socket connected! ID:', socket?.id);
        setIsConnected(true);
        if (socket?.id) {
          setMyId(socket.id);
          socket.emit('init', { x: playerRef.current?.x, y: playerRef.current?.y });
        }
      });

      socket.on('disconnect', () => {
        console.log('Socket disconnected');
        setIsConnected(false);
        setMyId(null);
      });

      socket.on('connect_error', (error) => {
        console.error('Connection error:', error.message);
        setIsConnected(false);
      });

      socket.on('players', (playersData) => {
        console.log('Received players:', playersData);
        playersRef.current = playersData;
      });

      socket.on('playerJoined', (newPlayer) => {
        console.log('New player joined:', newPlayer);
        playersRef.current = { ...playersRef.current, [newPlayer.id]: newPlayer };
      });

      socket.on('playerLeft', (id) => {
        console.log('Player left:', id);
        const newPlayers = { ...playersRef.current };
        delete newPlayers[id];
        playersRef.current = newPlayers;
      });

      socket.on('playerMoved', ({ id, x, y }) => {
        if (!playersRef.current[id]) return;
        playersRef.current = { ...playersRef.current, [id]: { x, y } };
      });

      socket.on('knivesUpdate', (knivesData: [string, Knife][]) => {
        // Update knives from server with shooterId
        knivesRef.current = knivesData.map(([id, knife]) => ({
          x: knife.x,
          y: knife.y,
          dx: knife.dx,
          dy: knife.dy,
          id: knife.id,
          shooterId: knife.shooterId
        }));
      });

      socket.on('knifeFired', (knife: Knife) => {
        // Only add the knife if it's not already in our list
        if (!knivesRef.current.some(k => k.id === knife.id)) {
          knivesRef.current.push({
            x: knife.x,
            y: knife.y,
            dx: knife.dx,
            dy: knife.dy,
            id: knife.id,
            shooterId: knife.shooterId
          });
        }
      });
    }

    return () => {
      if (socket) {
        console.log('Cleaning up socket connection...');
        socket.disconnect();
        socket = null;
      }
    };
  }, []); // Empty dependency array - only run once

  // Cleanup function for reload timeout
  const cleanupReload = () => {
    if (reloadTimeoutRef.current) {
      clearTimeout(reloadTimeoutRef.current);
      reloadTimeoutRef.current = null;
    }
  };

  // Start reload countdown
  const startReload = () => {
    console.log('Starting reload sequence');
    
    // Clean up any existing timeout
    cleanupReload();
    
    // Set initial reload state
    setIsReloading(true);
    setCanFire(false);
    setReloadText("3");
    
    console.log('Set initial reload state:', { isReloading: true, canFire: false, reloadText: "3" });

    // Set up countdown sequence with shorter intervals
    reloadTimeoutRef.current = setTimeout(() => {
      console.log('Countdown: 2');
      setReloadText("2");
      setIsReloading(true);
      setCanFire(false);

      reloadTimeoutRef.current = setTimeout(() => {
        console.log('Countdown: 1');
        setReloadText("1");
        setIsReloading(true);
        setCanFire(false);

        reloadTimeoutRef.current = setTimeout(() => {
          console.log('Countdown finished, ready to fire');
          setReloadText("Fire");
          setIsReloading(false);
          setCanFire(true);
          reloadTimeoutRef.current = null;
        }, 500); // Reduced from 1000ms to 500ms
      }, 500); // Reduced from 1000ms to 500ms
    }, 500); // Reduced from 1000ms to 500ms
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupReload();
    };
  }, []);

  // Separate effect for click handling
  useEffect(() => {
    if (!isConnected || !myId) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const handleClick = (e: MouseEvent) => {
      // Only handle left click
      if (e.button !== 0) return;
      
      console.log('Left click detected!');
      
      if (!socket || !myId || !playerRef.current) {
        console.log('No socket, ID, or player not spawned, returning');
        return;
      }
      
      // Only allow firing if we're not reloading and can fire
      if (!isReloading && canFire && reloadText === "Fire") {
        console.log('Firing knife!');
        const currentPos = playerRef.current;
        const dx = mouseRef.current.x - currentPos.x;
        const dy = mouseRef.current.y - currentPos.y;
        const angle = Math.atan2(dy, dx);
        const knifeSpeed = 24;

        const knifeId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const knife = {
          x: currentPos.x,
          y: currentPos.y,
          dx: Math.cos(angle) * knifeSpeed,
          dy: Math.sin(angle) * knifeSpeed,
          id: knifeId,
          shooterId: myId
        };

        knivesRef.current.push(knife);
        socket.emit('knife', knife);
        
        // Start reload countdown
        console.log('Starting reload sequence');
        startReload();
      } else {
        console.log('Cannot fire - conditions not met:', { isReloading, canFire, reloadText });
      }
    };

    canvas.addEventListener('mousedown', handleClick);
    return () => {
      canvas.removeEventListener('mousedown', handleClick);
    };
  }, [isConnected, myId, isReloading, canFire, reloadText]);

  // Separate effect for drawing the reload box
  useEffect(() => {
    if (!isConnected || !myId) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) return;

    const drawReloadBox = () => {
      // Draw reload box
      const reloadBoxX = 650;
      const reloadBoxY = 450;
      const reloadBoxSize = 60;

      // Box background (green when ready, red when reloading)
      const boxColor = (!isReloading && canFire && reloadText === "Fire") ? '#4CAF50' : '#f44336';
      console.log('Drawing box with color:', boxColor, { isReloading, canFire, reloadText });
      
      ctx.fillStyle = boxColor;
      ctx.fillRect(reloadBoxX, reloadBoxY, reloadBoxSize, reloadBoxSize);
      
      // Box border
      ctx.strokeStyle = '#000';
      ctx.lineWidth = 2;
      ctx.strokeRect(reloadBoxX, reloadBoxY, reloadBoxSize, reloadBoxSize);

      // Text (shows "Fire" or countdown)
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 16px Arial';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(reloadText, reloadBoxX + reloadBoxSize/2, reloadBoxY + reloadBoxSize/2);

      requestAnimationFrame(drawReloadBox);
    };

    const reloadBoxLoop = requestAnimationFrame(drawReloadBox);

    return () => {
      cancelAnimationFrame(reloadBoxLoop);
    };
  }, [isConnected, myId, isReloading, canFire, reloadText]); // Only depend on reload states

  // Socket event handlers effect
  useEffect(() => {
    if (!socket || !isConnected || !myId) return;

    const currentSocket = socket;
    console.log('Setting up socket event handlers for player:', myId);

    // Handle knife hits
    const handleKnifeHit = (data: { knifeId: string, hitPlayerId: string, shooterId: string }) => {
      console.log('Received knife hit event:', data);
      // Remove the knife that hit
      knivesRef.current = knivesRef.current.filter(k => k.id !== data.knifeId);
    };

    // Handle points updates
    const handlePointsUpdate = (data: { playerId: string, points: number }) => {
      console.log('Received points update:', data);
      if (data.playerId === myId) {
        pointsRef.current = data.points;
      }
    };

    // Handle player movement updates
    const handlePlayerMoved = ({ id, x, y }: { id: string, x: number, y: number }) => {
      if (id === myId) return; // Don't update our own position from server
      if (playersRef.current[id]) {
        playersRef.current = { ...playersRef.current, [id]: { x, y } };
      }
    };

    // Handle knife updates from server
    const handleKnivesUpdate = (knivesData: [string, Knife][]) => {
      knivesRef.current = knivesData.map(([id, knife]) => ({
        x: knife.x,
        y: knife.y,
        dx: knife.dx,
        dy: knife.dy,
        id: knife.id,
        shooterId: knife.shooterId
      }));
    };

    currentSocket.on('knifeHit', handleKnifeHit);
    currentSocket.on('pointsUpdate', handlePointsUpdate);
    currentSocket.on('playerMoved', handlePlayerMoved);
    currentSocket.on('knivesUpdate', handleKnivesUpdate);

    return () => {
      console.log('Cleaning up socket event handlers');
      currentSocket.off('knifeHit', handleKnifeHit);
      currentSocket.off('pointsUpdate', handlePointsUpdate);
      currentSocket.off('playerMoved', handlePlayerMoved);
      currentSocket.off('knivesUpdate', handleKnivesUpdate);
    };
  }, [isConnected, myId]);

  // Separate effect for movement handling
  useEffect(() => {
    if (!isConnected || !myId) {
      console.log('Waiting for connection...', { isConnected, myId });
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      console.error('Canvas not available');
      return;
    }

    const keys = { w: false, a: false, s: false, d: false };
    const currentSocket = socket;
    if (!currentSocket) {
      console.error('Socket not available');
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W') keys.w = true;
      if (e.key === 's' || e.key === 'S') keys.s = true;
      if (e.key === 'a' || e.key === 'A') keys.a = true;
      if (e.key === 'd' || e.key === 'D') keys.d = true;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W') keys.w = false;
      if (e.key === 's' || e.key === 'S') keys.s = false;
      if (e.key === 'a' || e.key === 'A') keys.a = false;
      if (e.key === 'd' || e.key === 'D') keys.d = false;
    };

    const handleMouseMove = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current.x = e.clientX - rect.left;
      mouseRef.current.y = e.clientY - rect.top;
    };

    const movePlayer = () => {
      // Don't move if player hasn't spawned
      if (!playerRef.current) return;

      const speed = 3;
      let moved = false;
      const arenaCenter = { x: 400, y: 300 };
      const arenaRadius = 250;
      const playerRadius = playerRef.current.radius;
      const centerLineY = 300; // Y-coordinate of the center line

      let newX = playerRef.current.x;
      let newY = playerRef.current.y;

      if (keys.w) newY -= speed;
      if (keys.s) newY += speed;
      if (keys.a) newX -= speed;
      if (keys.d) newX += speed;

      // Check arena boundary
      const distToCenter = Math.hypot(newX - arenaCenter.x, newY - arenaCenter.y);
      if (distToCenter + playerRadius > arenaRadius) {
        return;
      }

      // Check center line boundary
      // If player is in top half, prevent moving below center line
      if (playerRef.current.y < centerLineY && newY + playerRadius > centerLineY) {
        newY = centerLineY - playerRadius;
      }
      // If player is in bottom half, prevent moving above center line
      else if (playerRef.current.y > centerLineY && newY - playerRadius < centerLineY) {
        newY = centerLineY + playerRadius;
      }

      // Update position if we have a valid move
      if (newX !== playerRef.current.x || newY !== playerRef.current.y) {
        playerRef.current.x = newX;
        playerRef.current.y = newY;
        moved = true;
      }

      // Send movement update if moved and enough time has passed
      if (moved) {
        const now = Date.now();
        if (now - lastMoveTimeRef.current >= MOVE_UPDATE_INTERVAL) {
          currentSocket.emit('move', { x: playerRef.current.x, y: playerRef.current.y });
          lastMoveTimeRef.current = now;
        }
      }
    };

    // Movement update loop
    const movementLoop = setInterval(movePlayer, 1000 / 60);

    // Add event listeners
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    canvas.addEventListener('mousemove', handleMouseMove);

    // Cleanup
    return () => {
      clearInterval(movementLoop);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      canvas.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isConnected, myId]); // Only depend on connection state

  // Game loop effect (drawing only)
  useEffect(() => {
    if (!isConnected || !myId) {
      console.log('Waiting for connection...', { isConnected, myId });
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || !canvas) {
      console.error('Canvas context not available');
      return;
    }

    const draw = () => {
      // Clear canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw arena
      ctx.beginPath();
      ctx.arc(400, 300, 250, 0, 2 * Math.PI);
      ctx.strokeStyle = '#444';
      ctx.stroke();

      // Draw center line
      ctx.beginPath();
      ctx.moveTo(150, 300);
      ctx.lineTo(650, 300);
      ctx.strokeStyle = 'red';
      ctx.stroke();

      // Draw timer if game is in progress
      if (gameTimer !== null) {
        console.log('Drawing timer:', gameTimer);
        // Timer box with shadow
        const timerBoxX = 20;
        const timerBoxY = 20;
        const timerBoxWidth = 120;
        const timerBoxHeight = 50;

        // Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(timerBoxX + 4, timerBoxY + 4, timerBoxWidth, timerBoxHeight);

        // Box background
        ctx.fillStyle = '#FF5722';
        ctx.fillRect(timerBoxX, timerBoxY, timerBoxWidth, timerBoxHeight);
        
        // Box border
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.strokeRect(timerBoxX, timerBoxY, timerBoxWidth, timerBoxHeight);

        // Timer text
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 24px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${gameTimer}s`, timerBoxX + timerBoxWidth/2, timerBoxY + timerBoxHeight/2);

        // "Time Remaining" label
        ctx.font = 'bold 14px Arial';
        ctx.fillText('Time Remaining', timerBoxX + timerBoxWidth/2, timerBoxY - 5);
      }

      // Draw end game scores if available
      if (gameEndScores) {
        console.log('Drawing end game scores:', gameEndScores);
        const scoresBoxX = 20;
        const scoresBoxY = 90;
        const scoresBoxWidth = 250;
        const scoresBoxHeight = 120;

        // Shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.fillRect(scoresBoxX + 4, scoresBoxY + 4, scoresBoxWidth, scoresBoxHeight);

        // Box background
        ctx.fillStyle = 'rgba(0, 0, 0, 0.9)';
        ctx.fillRect(scoresBoxX, scoresBoxY, scoresBoxWidth, scoresBoxHeight);
        
        // Box border
        ctx.strokeStyle = '#FF5722';
        ctx.lineWidth = 3;
        ctx.strokeRect(scoresBoxX, scoresBoxY, scoresBoxWidth, scoresBoxHeight);

        // Title
        ctx.fillStyle = '#FF5722';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText('GAME OVER', scoresBoxX + scoresBoxWidth/2, scoresBoxY + 10);

        // Scores
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 18px Arial';
        ctx.textAlign = 'left';
        
        let yOffset = scoresBoxY + 45;
        Object.entries(gameEndScores).forEach(([id, score], index) => {
          const playerName = id === myId ? 'You' : 'Other Player';
          const scoreText = `${playerName}: ${score} points`;
          ctx.fillText(scoreText, scoresBoxX + 20, yOffset);
          yOffset += 30;
        });

        // Winner announcement
        const scores = Object.entries(gameEndScores);
        if (scores.length === 2) {
          const [id1, score1] = scores[0];
          const [id2, score2] = scores[1];
          const winnerText = score1 > score2 ? 
            (id1 === myId ? 'You Win!' : 'Other Player Wins!') :
            score2 > score1 ?
            (id2 === myId ? 'You Win!' : 'Other Player Wins!') :
            'It\'s a Tie!';
          
          ctx.fillStyle = '#FF5722';
          ctx.font = 'bold 24px Arial';
          ctx.textAlign = 'center';
          ctx.fillText(winnerText, scoresBoxX + scoresBoxWidth/2, yOffset + 10);
        }
      }

      // Draw reload box (only if player has spawned)
      if (playerRef.current) {
        const reloadBoxX = 650;
        const reloadBoxY = 450;
        const reloadBoxSize = 60;

        // Box background
        const boxColor = (!isReloading && canFire && reloadText === "Fire") ? '#4CAF50' : '#f44336';
        ctx.fillStyle = boxColor;
        ctx.fillRect(reloadBoxX, reloadBoxY, reloadBoxSize, reloadBoxSize);
        
        // Box border
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(reloadBoxX, reloadBoxY, reloadBoxSize, reloadBoxSize);

        // Reload text
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 16px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(reloadText, reloadBoxX + reloadBoxSize/2, reloadBoxY + reloadBoxSize/2);

        // Draw points display
        const pointsBoxX = 650;
        const pointsBoxY = 50;
        const pointsBoxWidth = 100;
        const pointsBoxHeight = 40;

        ctx.fillStyle = '#2196F3';
        ctx.fillRect(pointsBoxX, pointsBoxY, pointsBoxWidth, pointsBoxHeight);
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.strokeRect(pointsBoxX, pointsBoxY, pointsBoxWidth, pointsBoxHeight);
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`Points: ${pointsRef.current}`, pointsBoxX + pointsBoxWidth/2, pointsBoxY + pointsBoxHeight/2);
      }

      // Draw knives
      knivesRef.current.forEach(knife => {
        ctx.beginPath();
        ctx.arc(knife.x, knife.y, 5, 0, 2 * Math.PI);
        ctx.fillStyle = 'black';
        ctx.fill();
      });

      // Draw other players
      Object.entries(playersRef.current).forEach(([id, p]) => {
        if (id === myId) return;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 20, 0, 2 * Math.PI);
        ctx.fillStyle = 'green';
        ctx.fill();
        ctx.fillStyle = 'black';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Player', p.x, p.y - 30);
      });

      // Draw local player (only if spawned)
      if (playerRef.current) {
        ctx.beginPath();
        ctx.arc(playerRef.current.x, playerRef.current.y, playerRef.current.radius, 0, 2 * Math.PI);
        ctx.fillStyle = 'blue';
        ctx.fill();
        ctx.fillStyle = 'black';
        ctx.font = '12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('You', playerRef.current.x, playerRef.current.y - 30);
      }

      requestAnimationFrame(draw);
    };

    // Start game loop
    const gameLoop = requestAnimationFrame(draw);

    // Cleanup
    return () => {
      cancelAnimationFrame(gameLoop);
    };
  }, [isConnected, myId, gameTimer, gameEndScores]); // Keep game state dependencies for drawing

  // Debug logging
  console.log('Current players state:', playersRef.current);
  console.log('My ID:', myId);
  console.log('Is connected:', isConnected);

  // Add spawn slots update handler
  useEffect(() => {
    const currentSocket = socket;
    if (!currentSocket) return;

    const handleSpawnSlotsUpdate = (slots: SpawnSlots) => {
      console.log('Received spawn slots update:', slots);
      setSpawnSlots(slots);
      
      // If our player ID is no longer in any slot, we've been despawned
      if (playerRef.current && 
          slots.top.playerId !== myId && 
          slots.bottom.playerId !== myId) {
        console.log('Player despawned, removing blue ball');
        playerRef.current = null;
      }
    };

    const handleSpawnRejected = ({ position, reason }: { position: 'top' | 'bottom', reason: string }) => {
      console.log(`Spawn rejected at ${position}: ${reason}`);
      // If spawn was rejected, ensure we're not spawned
      playerRef.current = null;
    };

    currentSocket.on('spawnSlotsUpdate', handleSpawnSlotsUpdate);
    currentSocket.on('spawnRejected', handleSpawnRejected);

    return () => {
      currentSocket.off('spawnSlotsUpdate', handleSpawnSlotsUpdate);
      currentSocket.off('spawnRejected', handleSpawnRejected);
    };
  }, [socket, myId]);

  // Handle spawn button clicks
  const handleSpawn = (position: 'top' | 'bottom') => {
    if (!socket || !isConnected) return;
    
    // If we're clicking our current slot, despawn
    if (playerRef.current && 
        ((position === 'top' && spawnSlots.top.playerId === myId) || 
         (position === 'bottom' && spawnSlots.bottom.playerId === myId))) {
      socket.emit('requestSpawn', { position });
      return;
    }

    // If slot is occupied by someone else, don't spawn
    if ((position === 'top' && spawnSlots.top.occupied && spawnSlots.top.playerId !== myId) ||
        (position === 'bottom' && spawnSlots.bottom.occupied && spawnSlots.bottom.playerId !== myId)) {
      return;
    }

    // Calculate spawn position
    const spawnY = position === 'top' ? 200 : 400;
    const spawnX = 400;

    // Initialize player at spawn position
    playerRef.current = {
      x: spawnX,
      y: spawnY,
      radius: 20
    };

    // Request spawn from server (this will automatically despawn us from other slot if needed)
    socket.emit('requestSpawn', { position });
  };

  // Add game state handlers
  useEffect(() => {
    const currentSocket = socket;
    if (!currentSocket) return;

    console.log('Setting up game state handlers');

    const handleGameTimerUpdate = (timeLeft: number) => {
      console.log('Game timer update received:', timeLeft);
      setGameTimer(timeLeft);
      // Force a re-render by updating a dummy state
      setReloadText(prev => prev);
    };

    const handleGameEnd = (data: { scores: { [id: string]: number } }) => {
      console.log('Game end received with scores:', data.scores);
      setGameEndScores(data.scores);
      setGameTimer(null);
      // Force a re-render by updating a dummy state
      setReloadText(prev => prev);
      // Clear scores after a delay
      setTimeout(() => {
        console.log('Clearing game end scores');
        setGameEndScores(null);
        // Force a re-render by updating a dummy state
        setReloadText(prev => prev);
      }, 5000);
    };

    currentSocket.on('gameTimerUpdate', handleGameTimerUpdate);
    currentSocket.on('gameEnd', handleGameEnd);

    return () => {
      console.log('Cleaning up game state handlers');
      currentSocket.off('gameTimerUpdate', handleGameTimerUpdate);
      currentSocket.off('gameEnd', handleGameEnd);
    };
  }, [socket]);

  // Debug logging for game state
  useEffect(() => {
    console.log('Game state updated:', { 
      gameTimer, 
      gameEndScores, 
      spawnSlots,
      isConnected,
      myId,
      hasSpawned
    });
  }, [gameTimer, gameEndScores, spawnSlots, isConnected, myId, hasSpawned]);

  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      display: 'flex', 
      justifyContent: 'center', 
      alignItems: 'center',
      background: 'white'
    }}>
      <div style={{ position: 'relative' }}>
        <canvas
          ref={canvasRef}
          width={800}
          height={600}
          style={{
            display: 'block',
            background: '#eee',
            border: '2px solid #000',
            cursor: 'crosshair'
          }}
        />
        <div style={{
          position: 'absolute',
          right: -200, // Moved further right
          top: '50%',
          transform: 'translateY(-50%)',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px'
        }}>
          <button
            onClick={() => handleSpawn('top')}
            style={{
              padding: '15px 30px',
              fontSize: '16px',
              backgroundColor: spawnSlots.top.occupied ? '#ff4444' : '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              position: 'relative'
            }}
          >
            {spawnSlots.top.occupied ? 'Top Slot Occupied' : 'Spawn Top'}
            {spawnSlots.top.occupied && (
              <div style={{
                position: 'absolute',
                top: -20,
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: '12px',
                color: '#666'
              }}>
                {spawnSlots.top.playerId === myId ? 'You' : 'Other Player'}
              </div>
            )}
          </button>
          <button
            onClick={() => handleSpawn('bottom')}
            style={{
              padding: '15px 30px',
              fontSize: '16px',
              backgroundColor: spawnSlots.bottom.occupied ? '#ff4444' : '#2196F3',
              color: 'white',
              border: 'none',
              borderRadius: '5px',
              cursor: 'pointer',
              boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
              position: 'relative'
            }}
          >
            {spawnSlots.bottom.occupied ? 'Bottom Slot Occupied' : 'Spawn Bottom'}
            {spawnSlots.bottom.occupied && (
              <div style={{
                position: 'absolute',
                top: -20,
                left: '50%',
                transform: 'translateX(-50%)',
                fontSize: '12px',
                color: '#666'
              }}>
                {spawnSlots.bottom.playerId === myId ? 'You' : 'Other Player'}
              </div>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
