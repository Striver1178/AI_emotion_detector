
const video = document.getElementById('videoElement');
const canvas = document.getElementById('overlayCanvas');
const statusMessage = document.getElementById('statusMessage');
const toggleCameraBtn = document.getElementById('toggleCamera');


const MODEL_PATH = '/models';
const EMOTION_DATA = {
    neutral: { color: '#636e72', icon: '😐' },
    happy: { color: '#fdcb6e', icon: '😊' },
    sad: { color: '#0984e3', icon: '😢' },
    angry: { color: '#d63031', icon: '😠' },
    fearful: { color: '#6c5ce7', icon: '😨' },
    disgusted: { color: '#00b894', icon: '🤢' },
    surprised: { color: '#e84393', icon: '😲' }
};


let modelsLoaded = false;
let cameraActive = false;
let detectionInterval = null;


function initEmotionBars() {
    const emotionBars = document.querySelector('.emotion-bars');
    emotionBars.innerHTML = Object.entries(EMOTION_DATA).map(([emotion, data]) => `
        <div class="emotion-bar">
            <span class="emotion-label">${emotion}</span>
            <div class="bar-container">
                <div class="bar" id="${emotion}-bar" style="background: ${data.color}"></div>
            </div>
            <span class="emotion-percent" id="${emotion}-percent">0%</span>
        </div>
    `).join('');
}

// Load models with absolute verification
async function loadModels() {
    try {
        statusMessage.textContent = 'Loading AI models...';
        
        // 1. First verify model files exist
        await verifyModelFiles(); //
        
        // 2. Clear any previous model state (this might be redundant with modern face-api.js, but harmless)
        // resetModelStates(); // Removed as it might cause issues if not carefully managed. Face-API handles internal state.
        
        // 3. Load using the TINY variant (must match your files)
        console.log('Loading TinyFaceDetector...');
        await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_PATH); //
        
        console.log('Loading FaceLandmark68TinyNet...');
        await faceapi.nets.faceLandmark68TinyNet.loadFromUri(MODEL_PATH); //
        
        // 4. CRITICAL VERIFICATION: Check .params property for full initialization
        if (!faceapi.nets.faceLandmark68TinyNet.params) {
            throw new Error("FaceLandmark68TinyNet failed to initialize correctly. Params are missing."); //
        }
        
        console.log('Loading FaceExpressionNet...');
        await faceapi.nets.faceExpressionNet.loadFromUri(MODEL_PATH); //

        // 5. Final verification using isLoaded and params
        modelsLoaded = (
            faceapi.nets.tinyFaceDetector.isLoaded &&
            !!faceapi.nets.faceLandmark68TinyNet.params && //
            faceapi.nets.faceExpressionNet.isLoaded
        );

        if (!modelsLoaded) {
            throw new Error("One or more models failed final verification."); //
        }

        statusMessage.textContent = 'Models loaded successfully!';
        console.log('All models verified and ready');
        return true;
    } catch (error) {
        console.error("MODEL LOAD ERROR:", error);
        statusMessage.textContent = `Model error: ${error.message}. Trying CDN fallback...`; //
        
        // Try CDN fallback
        console.log('Attempting CDN fallback...');
        try {
            // Load all models from CDN in parallel for faster fallback
            await Promise.all([
                faceapi.nets.tinyFaceDetector.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js-models/models'),
                faceapi.nets.faceLandmark68TinyNet.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js-models/models'),
                faceapi.nets.faceExpressionNet.loadFromUri('https://cdn.jsdelivr.net/npm/face-api.js-models/models')
            ]);
            modelsLoaded = true;
            statusMessage.textContent = 'Models loaded from CDN!'; //
            console.log('Models successfully loaded from CDN.');
            return true;
        } catch (cdnError) {
            console.error('CDN fallback failed:', cdnError); //
            statusMessage.textContent = `Critical error: Could not load models from local or CDN. ${cdnError.message}`;
            return false;
        }
    }
}

// Helper function to verify model files exist
async function verifyModelFiles() {
    // These are the actual JSON manifest files face-api.js requests first
    const requiredFiles = [
        'tiny_face_detector_model-weights_manifest.json', // Corrected name for TinyFaceDetector manifest
        'face_landmark_68_tiny_model-weights_manifest.json', //
        'face_expression_model-weights_manifest.json'
    ];
    
    for (const file of requiredFiles) {
        try {
            const response = await fetch(`${MODEL_PATH}/${file}`); //
            if (!response.ok) {
                throw new Error(`Status ${response.status}`);
            }
            console.log(`Model ${MODEL_PATH}/${file} status: ${response.status}`);
        } catch (error) {
            throw new Error(`Failed to load ${file} locally: ${error.message}. Ensure files are in '${MODEL_PATH}' and server is running.`); //
        }
    }
}

// Camera control
async function toggleCamera() {
    if (!cameraActive) {
        try {
            if (!modelsLoaded) {
                statusMessage.textContent = 'Models not yet loaded. Please wait...';
                const loaded = await loadModels(); //
                if (!loaded) {
                    statusMessage.textContent = 'Failed to load models. Cannot start camera.';
                    return;
                }
            }

            const stream = await navigator.mediaDevices.getUserMedia({ 
                video: { width: { ideal: 640 }, height: { ideal: 480 } } 
            });
            
            video.srcObject = stream;
            cameraActive = true;
            toggleCameraBtn.textContent = '⏹ Stop Camera';
            
            // Set up dimensions as soon as metadata is available
            video.onloadedmetadata = () => { //
                setupVideoDimensions();
            };

            // Start detection only when the video actually begins playing
            video.onplay = () => { //
                startDetection();
            };
            
        } catch (error) {
            console.error('Camera error:', error);
            statusMessage.textContent = `Camera error: ${error.message}. Make sure you have a webcam and granted permissions.`;
        }
    } else {
        stopCamera();
    }
}

// Setup video dimensions
function setupVideoDimensions() {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    // faceapi.matchDimensions is needed here if you plan to resize results
    // You'd typically want displaySize to match video dimensions if no scaling is done
}

// Stop camera and clean up
function stopCamera() {
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop()); //
    }
    cameraActive = false;
    toggleCameraBtn.textContent = '🎥 Start Camera';
    
    if (detectionInterval) {
        clearInterval(detectionInterval); //
        detectionInterval = null;
    }
    
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    resetEmotionDisplay();
}

// Reset emotion display
function resetEmotionDisplay() {
    Object.keys(EMOTION_DATA).forEach(emotion => {
        const bar = document.getElementById(`${emotion}-bar`);
        const percent = document.getElementById(`${emotion}-percent`);
        if (bar && percent) {
            bar.style.width = '0%'; //
            percent.textContent = '0%'; //
        }
    });
    document.querySelector('.emotion-icon').textContent = '👁️'; //
    document.querySelector('.emotion-value').textContent = '0%'; //
}

// Face detection
function startDetection() {
    // Clear any existing interval before starting a new one
    if (detectionInterval) {
        clearInterval(detectionInterval);
        detectionInterval = null;
    }

    const displaySize = { width: video.videoWidth, height: video.videoHeight };
    faceapi.matchDimensions(canvas, displaySize); // Ensure canvas matches video dimensions for drawing

    // New polling mechanism to ensure models are truly ready before starting setInterval
    const ensureModelReady = () => { //
        if (faceapi.nets.faceLandmark68TinyNet?.params && modelsLoaded) { // Check for .params and overall modelsLoaded flag
            statusMessage.textContent = 'Webcam active. Detecting faces...';
            
            detectionInterval = setInterval(async () => {
                try {
                    // Re-verify model readiness inside the loop as a safeguard
                    if (!faceapi.nets.faceLandmark68TinyNet?.params || !modelsLoaded) {
                        console.warn('Landmark model not ready or models not loaded, stopping detection loop.');
                        clearInterval(detectionInterval);
                        detectionInterval = null;
                        statusMessage.textContent = 'Detection stopped: Models became unready. Please restart camera.';
                        return;
                    }

                    const detections = await faceapi.detectAllFaces(
                        video, 
                        new faceapi.TinyFaceDetectorOptions()
                    )
                    .withFaceLandmarks(faceapi.nets.faceLandmark68TinyNet) // Explicitly use TinyLandmark model
                    .withFaceExpressions();

                    const resizedDetections = faceapi.resizeResults(detections, displaySize);
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);

                    if (resizedDetections.length > 0) {
                        faceapi.draw.drawDetections(canvas, resizedDetections);
                        // Optional: draw landmarks if needed for debugging
                        // faceapi.draw.drawFaceLandmarks(canvas, resizedDetections);
                        updateEmotionUI(resizedDetections[0].expressions); //
                    } else {
                        resetEmotionDisplay(); //
                    }
                } catch (error) {
                    console.error('Detection loop error:', error);
                    // If the error explicitly mentions a model not being loaded before inference
                    if (error.message.includes('load model before inference') || !modelsLoaded) {
                        console.error('Model not ready for inference during detection. Attempting to reload models...'); //
                        clearInterval(detectionInterval); // Stop current interval
                        detectionInterval = null; // Reset interval ID
                        statusMessage.textContent = 'Models became unresponsive. Attempting reload...';
                        
                        // Attempt to reload models and restart detection
                        loadModels().then(loaded => { //
                            if (loaded && cameraActive) {
                                statusMessage.textContent = 'Models reloaded. Resuming detection.';
                                startDetection(); // Restart detection if successful and camera is still active
                            } else if (!loaded) {
                                statusMessage.textContent = 'Failed to reload models. Please refresh page.';
                            }
                        }).catch(reloadError => {
                            console.error('Error during reload attempt:', reloadError);
                            statusMessage.textContent = 'Critical error during model reload. Please refresh page.';
                        });
                    }
                }
            }, 100); // ~10 FPS
        } else {
            statusMessage.textContent = 'Models still initializing. Waiting for full readiness...'; //
            setTimeout(ensureModelReady, 200); // Poll every 200ms until models are ready
        }
    };

    // Initial call to start the polling for model readiness
    ensureModelReady(); //
}

// Update emotion display
function updateEmotionUI(expressions) {
    let maxEmotion = 'neutral';
    let maxValue = 0;

    Object.entries(expressions).forEach(([emotion, value]) => {
        const percent = Math.round(value * 100); //
        const bar = document.getElementById(`${emotion}-bar`); //
        const percentElement = document.getElementById(`${emotion}-percent`); //
        
        if (bar && percentElement) {
            bar.style.width = `${percent}%`; //
            percentElement.textContent = `${percent}%`; //
            
            if (value > maxValue) {
                maxValue = value; //
                maxEmotion = emotion; //
            }
        }
    });

    if (EMOTION_DATA[maxEmotion]) {
        const iconElement = document.querySelector('.emotion-icon'); //
        const valueElement = document.querySelector('.emotion-value'); //
        iconElement.textContent = EMOTION_DATA[maxEmotion].icon; //
        valueElement.textContent = `${Math.round(maxValue * 100)}%`; //
        iconElement.style.color = EMOTION_DATA[maxEmotion].color; //
    }
}

// Initialize app
async function init() {
    initEmotionBars(); //
    // loadModels will now be called by toggleCamera, but keeping it here for initial status update
    // Awaiting here ensures models load *before* toggle button is clickable
    await loadModels(); 
    
    // Event listeners
    toggleCameraBtn.addEventListener('click', toggleCamera); //
    
    // Clean up on exit
    window.addEventListener('beforeunload', () => { //
        if (video.srcObject) { //
            video.srcObject.getTracks().forEach(track => track.stop()); //
        }
        if (detectionInterval) { //
            clearInterval(detectionInterval); //
        }
    });
}

// Start app when ready
document.addEventListener('DOMContentLoaded', init); //