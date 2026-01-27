/**
 * Avatar Renderer
 * Handles Three.js scene setup, model loading, and rendering
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

class AvatarRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.scene = null;
        this.camera = null;
        this.renderer = null;
        this.controls = null;
        this.model = null;
        this.mixer = null;
        this.clock = new THREE.Clock();
        
        // Performance tracking
        this.frameCount = 0;
        this.lastFpsUpdate = 0;
        this.currentFps = 0;
        
        // Bone references for posing
        this.bones = {};
        
        // Head mesh reference for expressions
        this.headMesh = null;
        
        // Expression system
        this.expressionSystem = null;
        
        // Callbacks
        this.onLoad = null;
        this.onError = null;
        
        this.init();
    }

    init() {
        // Scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0a0a0a);

        // Camera - positioned to frame a head/upper body
        const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
        this.camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 100);
        this.camera.position.set(0, 1.6, 1.2); // Eye level, slightly back
        this.camera.lookAt(0, 1.5, 0);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true
        });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;

        // Orbit Controls
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.target.set(0, 1.5, 0);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 0.5;
        this.controls.maxDistance = 5;
        this.controls.maxPolarAngle = Math.PI * 0.9;
        this.controls.update();

        // Lighting
        this.setupLighting();

        // Handle resize
        window.addEventListener('resize', () => this.onResize());

        // Start render loop
        this.animate();
    }

    setupLighting() {
        // Key light (main light, slightly warm)
        const keyLight = new THREE.DirectionalLight(0xfff5e6, 1.2);
        keyLight.position.set(2, 3, 2);
        keyLight.castShadow = false;
        this.scene.add(keyLight);

        // Fill light (softer, cooler, from opposite side)
        const fillLight = new THREE.DirectionalLight(0xe6f0ff, 0.6);
        fillLight.position.set(-2, 2, 1);
        this.scene.add(fillLight);

        // Rim/back light (for depth)
        const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
        rimLight.position.set(0, 2, -3);
        this.scene.add(rimLight);

        // Ambient light (base illumination)
        const ambientLight = new THREE.AmbientLight(0x404060, 0.5);
        this.scene.add(ambientLight);

        // Subtle hemisphere light for natural feel
        const hemiLight = new THREE.HemisphereLight(0xffeeb1, 0x080820, 0.3);
        this.scene.add(hemiLight);
    }

    /**
     * Load a GLB model
     */
    async loadModel(url) {
        return new Promise((resolve, reject) => {
            const loader = new GLTFLoader();
            
            loader.load(
                url,
                (gltf) => {
                    console.log('Model loaded:', gltf);
                    
                    // Remove existing model if any
                    if (this.model) {
                        this.scene.remove(this.model);
                    }

                    this.model = gltf.scene;
                    
                    // Center and position the model
                    const box = new THREE.Box3().setFromObject(this.model);
                    const center = box.getCenter(new THREE.Vector3());
                    const size = box.getSize(new THREE.Vector3());
                    
                    // Center horizontally, keep feet on ground
                    this.model.position.x = -center.x;
                    this.model.position.z = -center.z;
                    this.model.position.y = -box.min.y; // Feet at y=0
                    
                    this.scene.add(this.model);

                    // CRITICAL: Build morphTargetDictionary from userData.targetNames
                    // Three.js GLTFLoader stores names in userData but doesn't populate the dictionary
                    this.model.traverse((node) => {
                        if (node.isMesh) {
                            // Build morphTargetDictionary from userData.targetNames if available
                            if (node.userData?.targetNames && Array.isArray(node.userData.targetNames)) {
                                node.morphTargetDictionary = {};
                                node.userData.targetNames.forEach((name, index) => {
                                    node.morphTargetDictionary[name] = index;
                                });
                                
                                // Log visemes found
                                const visemes = Object.keys(node.morphTargetDictionary).filter(k => k.includes('viseme'));
                                if (visemes.length > 0) {
                                    console.log(`Built morphTargetDictionary for ${node.name}: ${visemes.length} visemes found`);
                                    console.log('Visemes:', visemes);
                                }
                            }
                            
                            // Enable morph targets on materials
                            if (node.morphTargetInfluences) {
                                node.material.morphTargets = true;
                                node.material.morphNormals = true;
                                node.material.needsUpdate = true;
                            }
                        }
                    });

                    // Setup animation mixer if there are animations
                    if (gltf.animations && gltf.animations.length > 0) {
                        this.mixer = new THREE.AnimationMixer(this.model);
                        // Play the first animation (usually idle)
                        const idleAction = this.mixer.clipAction(gltf.animations[0]);
                        idleAction.play();
                        console.log('Playing animation:', gltf.animations[0].name);
                    }

                    // Initialize viseme mapper (for Oculus visemes)
                    if (window.VisemeMapper) {
                        const success = window.VisemeMapper.initialize(this.model);
                        if (!success) {
                            console.warn('No visemes found in model');
                        }
                    }
                    
                    // Also initialize blendshape mapper as fallback
                    if (window.BlendShapeMapper) {
                        window.BlendShapeMapper.initialize(this.model);
                    }

                    // Store bone references and position arms
                    this.setupBones();
                    
                    // Store head mesh reference for expressions
                    this.model.traverse((node) => {
                        if (node.name === 'Head_Mesh') {
                            this.headMesh = node;
                            window.headMesh = node; // Global access for console testing
                        }
                    });
                    
                    // Initialize expression system
                    this.expressionSystem = new ExpressionSystem(this.headMesh);
                    this.expressionSystem.start();

                    // Adjust camera to focus on face
                    this.focusOnFace();

                    resolve(gltf);
                },
                (progress) => {
                    const percent = (progress.loaded / progress.total * 100).toFixed(0);
                    console.log(`Loading: ${percent}%`);
                },
                (error) => {
                    console.error('Error loading model:', error);
                    reject(error);
                }
            );
        });
    }

    /**
     * Adjust camera to show head and shoulders
     */
    focusOnFace() {
        if (!this.model) return;

        // Get model bounds
        const box = new THREE.Box3().setFromObject(this.model);
        const height = box.max.y - box.min.y;
        
        // Target face level (about 85-90% up the model, roughly eye level)
        const faceY = height * 0.88;

        // Rotate model to face camera (Avaturn models often face wrong direction)
        this.model.rotation.y = Math.PI;
        
        // Position camera close for head/shoulder view
        this.camera.position.set(0, faceY, 0.65);
        this.controls.target.set(0, faceY, 0);
        
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(0, faceY, 0);
        
        this.controls.update();
        console.log('Camera positioned for head/shoulder view, faceY:', faceY);
    }

    /**
     * Setup bone references and position arms naturally
     */
    setupBones() {
        // Find and store bone references
        this.model.traverse((node) => {
            if (node.isBone) {
                this.bones[node.name] = node;
            }
        });
        
        console.log('Found bones:', Object.keys(this.bones).length);
        
        // Lower arms from T-pose to a natural resting position
        this.positionArms();
    }

    /**
     * Position arms in a natural pose (lowered from T-pose)
     */
    positionArms() {
        // Right arm - rotate down and slightly forward
        if (this.bones.RightShoulder) {
            this.bones.RightShoulder.rotation.z = -0.3; // Rotate down
        }
        if (this.bones.RightArm) {
            this.bones.RightArm.rotation.z = -1.2; // Rotate down significantly
            this.bones.RightArm.rotation.x = 0.2;  // Slightly forward
        }
        if (this.bones.RightForeArm) {
            this.bones.RightForeArm.rotation.z = -0.3; // Slight bend at elbow
        }
        
        // Left arm - mirror of right
        if (this.bones.LeftShoulder) {
            this.bones.LeftShoulder.rotation.z = 0.3;
        }
        if (this.bones.LeftArm) {
            this.bones.LeftArm.rotation.z = 1.2;
            this.bones.LeftArm.rotation.x = 0.2;
        }
        if (this.bones.LeftForeArm) {
            this.bones.LeftForeArm.rotation.z = 0.3;
        }
        
        console.log('Arms positioned to natural resting pose');
    }

    /**
     * Handle window resize
     */
    onResize() {
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    /**
     * Animation loop
     */
    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();

        // Update animation mixer
        if (this.mixer) {
            this.mixer.update(delta);
        }

        // Update controls
        this.controls.update();

        // Render
        this.renderer.render(this.scene, this.camera);

        // FPS tracking
        this.frameCount++;
        const now = performance.now();
        if (now - this.lastFpsUpdate >= 1000) {
            this.currentFps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsUpdate = now;
        }
    }

    /**
     * Get current FPS
     */
    getFps() {
        return this.currentFps;
    }

    /**
     * Dispose of resources
     */
    dispose() {
        if (this.expressionSystem) {
            this.expressionSystem.stop();
        }
        if (this.renderer) {
            this.renderer.dispose();
        }
        if (this.controls) {
            this.controls.dispose();
        }
    }
}

/**
 * Expression System - Handles random/reactive facial expressions
 */
class ExpressionSystem {
    constructor(headMesh) {
        this.headMesh = headMesh;
        this.isRunning = false;
        this.blinkInterval = null;
        this.microExpressionInterval = null;
        
        // Expression state
        this.currentExpressions = {};
        
        // Available expressions (non-viseme morph targets)
        this.expressions = {
            // Blinks
            eyeBlinkLeft: 'eyeBlinkLeft',
            eyeBlinkRight: 'eyeBlinkRight',
            eyesClosed: 'eyesClosed',
            
            // Brows
            browDownLeft: 'browDownLeft',
            browDownRight: 'browDownRight',
            browInnerUp: 'browInnerUp',
            browOuterUpLeft: 'browOuterUpLeft',
            browOuterUpRight: 'browOuterUpRight',
            
            // Eyes
            eyeSquintLeft: 'eyeSquintLeft',
            eyeSquintRight: 'eyeSquintRight',
            eyeWideLeft: 'eyeWideLeft',
            eyeWideRight: 'eyeWideRight',
            
            // Mouth (non-viseme)
            mouthSmileLeft: 'mouthSmileLeft',
            mouthSmileRight: 'mouthSmileRight',
            mouthFrownLeft: 'mouthFrownLeft',
            mouthFrownRight: 'mouthFrownRight',
            
            // Cheeks
            cheekSquintLeft: 'cheekSquintLeft',
            cheekSquintRight: 'cheekSquintRight',
            cheekPuff: 'cheekPuff'
        };
    }

    start() {
        if (!this.headMesh || !this.headMesh.morphTargetDictionary) {
            console.warn('ExpressionSystem: No head mesh or morph targets available');
            return;
        }
        
        this.isRunning = true;
        
        // Start random blinking (every 2-6 seconds)
        this.startBlinking();
        
        // Start subtle micro-expressions (every 3-8 seconds)
        this.startMicroExpressions();
        
        console.log('ExpressionSystem started');
    }

    stop() {
        this.isRunning = false;
        if (this.blinkInterval) clearInterval(this.blinkInterval);
        if (this.microExpressionInterval) clearInterval(this.microExpressionInterval);
    }

    /**
     * Random blinking
     */
    startBlinking() {
        const blink = () => {
            if (!this.isRunning) return;
            
            // Quick blink animation
            this.animateExpression(['eyeBlinkLeft', 'eyeBlinkRight'], 1.0, 150, () => {
                this.animateExpression(['eyeBlinkLeft', 'eyeBlinkRight'], 0, 100);
            });
            
            // Schedule next blink (2-6 seconds)
            const nextBlink = 2000 + Math.random() * 4000;
            this.blinkInterval = setTimeout(blink, nextBlink);
        };
        
        // Start first blink after 1-3 seconds
        this.blinkInterval = setTimeout(blink, 1000 + Math.random() * 2000);
    }

    /**
     * Subtle micro-expressions for liveliness
     */
    startMicroExpressions() {
        const microExpressions = [
            // Slight eyebrow raise (curious/attentive)
            () => {
                this.animateExpression(['browInnerUp'], 0.3, 400, () => {
                    setTimeout(() => this.animateExpression(['browInnerUp'], 0, 600), 800);
                });
            },
            // Slight squint (thinking)
            () => {
                this.animateExpression(['eyeSquintLeft', 'eyeSquintRight'], 0.2, 300, () => {
                    setTimeout(() => this.animateExpression(['eyeSquintLeft', 'eyeSquintRight'], 0, 400), 600);
                });
            },
            // Subtle smile
            () => {
                this.animateExpression(['mouthSmileLeft', 'mouthSmileRight'], 0.15, 500, () => {
                    setTimeout(() => this.animateExpression(['mouthSmileLeft', 'mouthSmileRight'], 0, 700), 1000);
                });
            },
            // One eyebrow raise
            () => {
                const side = Math.random() > 0.5 ? 'browOuterUpLeft' : 'browOuterUpRight';
                this.animateExpression([side], 0.4, 300, () => {
                    setTimeout(() => this.animateExpression([side], 0, 400), 500);
                });
            }
        ];

        const doMicroExpression = () => {
            if (!this.isRunning) return;
            
            // Pick a random micro-expression
            const expr = microExpressions[Math.floor(Math.random() * microExpressions.length)];
            expr();
            
            // Schedule next (3-8 seconds)
            const nextExpr = 3000 + Math.random() * 5000;
            this.microExpressionInterval = setTimeout(doMicroExpression, nextExpr);
        };
        
        // Start after 2-4 seconds
        this.microExpressionInterval = setTimeout(doMicroExpression, 2000 + Math.random() * 2000);
    }

    /**
     * Animate expression(s) to a target value
     */
    animateExpression(names, targetValue, duration, onComplete) {
        if (!this.headMesh) return;
        
        const dict = this.headMesh.morphTargetDictionary;
        const influences = this.headMesh.morphTargetInfluences;
        
        names.forEach(name => {
            if (dict[name] === undefined) return;
            
            const idx = dict[name];
            const startValue = influences[idx];
            const startTime = performance.now();
            
            const animate = () => {
                const elapsed = performance.now() - startTime;
                const t = Math.min(elapsed / duration, 1);
                
                // Ease out
                const eased = 1 - Math.pow(1 - t, 2);
                influences[idx] = startValue + (targetValue - startValue) * eased;
                
                if (t < 1) {
                    requestAnimationFrame(animate);
                } else if (onComplete) {
                    onComplete();
                }
            };
            
            requestAnimationFrame(animate);
        });
    }

    /**
     * Set expression immediately (for reactive expressions)
     */
    setExpression(name, value) {
        if (!this.headMesh) return;
        const dict = this.headMesh.morphTargetDictionary;
        if (dict[name] !== undefined) {
            this.headMesh.morphTargetInfluences[dict[name]] = value;
        }
    }

    /**
     * React to user input (e.g., show interest when user speaks)
     */
    showInterest() {
        this.animateExpression(['browInnerUp', 'eyeWideLeft', 'eyeWideRight'], 0.3, 200);
        setTimeout(() => {
            this.animateExpression(['browInnerUp', 'eyeWideLeft', 'eyeWideRight'], 0, 500);
        }, 1000);
    }

    /**
     * React to completing speech
     */
    showSatisfaction() {
        this.animateExpression(['mouthSmileLeft', 'mouthSmileRight', 'cheekSquintLeft', 'cheekSquintRight'], 0.25, 300);
        setTimeout(() => {
            this.animateExpression(['mouthSmileLeft', 'mouthSmileRight', 'cheekSquintLeft', 'cheekSquintRight'], 0, 600);
        }, 800);
    }
}

// Make available globally
window.AvatarRenderer = AvatarRenderer;
window.ExpressionSystem = ExpressionSystem;
