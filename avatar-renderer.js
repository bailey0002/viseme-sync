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

                    // CRITICAL: Enable morph targets on all mesh materials
                    this.model.traverse((node) => {
                        if (node.isMesh && node.morphTargetInfluences) {
                            node.material.morphTargets = true;
                            node.material.morphNormals = true;
                            node.material.needsUpdate = true;
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
     * Adjust camera to show full body
     */
    focusOnFace() {
        if (!this.model) return;

        // Get model bounds
        const box = new THREE.Box3().setFromObject(this.model);
        const height = box.max.y - box.min.y;
        const centerY = height / 2;

        // Rotate model to face camera (Avaturn models often face wrong direction)
        this.model.rotation.y = Math.PI;
        
        // Position camera to show full body, straight on
        this.camera.position.set(0, centerY, 2.5);
        this.controls.target.set(0, centerY, 0);
        
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(0, centerY, 0);
        
        this.controls.update();
        console.log('Camera positioned for full body view');
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
        if (this.renderer) {
            this.renderer.dispose();
        }
        if (this.controls) {
            this.controls.dispose();
        }
    }
}

// Make available globally
window.AvatarRenderer = AvatarRenderer;
