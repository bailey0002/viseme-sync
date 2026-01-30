/**
 * Avatar Renderer
 * Handles Three.js scene setup, model loading, and rendering
 *
 * UPGRADED: Realistic materials for all mesh types
 * - Skin: Clearcoat + sheen for natural oily/velvety look
 * - Eyes: High clearcoat + IOR for wet cornea
 * - Teeth: Subtle wetness + translucency approximation
 * - Hair: Anisotropic highlights for strand-like reflections
 * - Eyelashes: Soft, non-shiny with rim lighting response
 * - Tongue: Wet, glossy mucous membrane look
 * 
 * FIXED (2025-01-29):
 * - Jaw correction to fix underbite
 * - Less sweaty skin
 * - Reduced mouth glow (teeth/tongue)
 * - Dark gray background
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

        // =====================================================
        // MATERIAL SETTINGS (all adjustable at runtime)
        // =====================================================
        this.materialSettings = {
            enabled: true,  // Master toggle for all upgrades

            // SKIN (Head_Mesh, Body_Mesh) - UPDATED: less sweaty, brighter
            skin: {
                clearcoat: 0.02,            // Reduced from 0.04 (less sweaty)
                clearcoatRoughness: 0.35,
                sheen: 0.15,                // Reduced from 0.25
                sheenRoughness: 0.6,
                sheenColor: new THREE.Color(0.95, 0.75, 0.65),
                roughness: 0.55,
                envMapIntensity: 1.0,       // Increased from 0.8 (brighter)
            },

            // EYES (Eye_Mesh)
            eyes: {
                clearcoat: 0.9,
                clearcoatRoughness: 0.05,
                roughness: 0.05,
                ior: 1.4,
                envMapIntensity: 1.5,
            },

            // EYE AMBIENT OCCLUSION (EyeAO_Mesh)
            eyeAO: {
                clearcoat: 0.02,
                roughness: 0.7,
                envMapIntensity: 0.3,
            },

            // TEETH (Teeth_Mesh) - UPDATED: less glowy
            teeth: {
                clearcoat: 0.1,             // Reduced from 0.25
                clearcoatRoughness: 0.3,
                roughness: 0.4,             // Increased from 0.25
                sheen: 0.1,
                sheenRoughness: 0.5,
                sheenColor: new THREE.Color(1.0, 0.98, 0.95),
                envMapIntensity: 0.3,       // Reduced from 0.6
            },

            // TONGUE (Tongue_Mesh) - UPDATED: much less glowy
            tongue: {
                clearcoat: 0.1,             // Reduced from 0.6
                clearcoatRoughness: 0.15,
                roughness: 0.7,             // Increased from 0.3
                sheen: 0.2,
                sheenRoughness: 0.4,
                sheenColor: new THREE.Color(0.9, 0.5, 0.5),
                envMapIntensity: 0.1,       // Reduced from 0.8
            },

            // HAIR (avaturn_hair_0, avaturn_hair_1)
            hair: {
                anisotropy: 0.4,
                anisotropyRotation: 0,
                roughness: 0.45,
                sheen: 0.2,
                sheenRoughness: 0.5,
                sheenColor: null,
                clearcoat: 0.03,
                clearcoatRoughness: 0.5,
                envMapIntensity: 0.4,
            },

            // EYELASHES (Eyelash_Mesh)
            eyelashes: {
                roughness: 0.5,
                sheen: 0.2,
                sheenRoughness: 0.6,
                sheenColor: new THREE.Color(0.1, 0.08, 0.08),
                clearcoat: 0.0,
                envMapIntensity: 0.3,
                alphaTest: 0.5,
                transparent: true,
            },
        };

        // Callbacks
        this.onLoad = null;
        this.onError = null;

        this.init();
    }

    init() {
        // Scene - UPDATED: dark gray background
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1a1a1a);  // Changed from 0x0a0a0a

        // Camera - positioned for full body view
        const aspect = this.canvas.clientWidth / this.canvas.clientHeight;
        this.camera = new THREE.PerspectiveCamera(35, aspect, 0.1, 100);
        this.camera.position.set(0, 1.2, 2.2);
        this.camera.lookAt(0, 1.2, 0);

        // Renderer with iOS-optimized settings
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance', // Request best GPU on iOS
            failIfMajorPerformanceCaveat: false  // Don't fail on low-end devices
        });
        
        // Limit pixel ratio on mobile to prevent performance issues
        const isMobile = /iPad|iPhone|iPod|Android/i.test(navigator.userAgent);
        const maxPixelRatio = isMobile ? 2 : 2;
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, maxPixelRatio));
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        this.renderer.useLegacyLights = false;

        // Check WebGL capabilities for iOS compatibility
        this.checkWebGLCapabilities();

        // Handle WebGL context loss (common on iOS)
        this.canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            console.error('[WebGL] Context lost');
            this.handleContextLoss();
        });

        this.canvas.addEventListener('webglcontextrestored', () => {
            console.log('[WebGL] Context restored');
            this.handleContextRestore();
        });

        // Orbit Controls with touch optimizations
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.target.set(0, 1.2, 0);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = isMobile ? 0.1 : 0.05; // Faster response on mobile
        this.controls.minDistance = 0.5;
        this.controls.maxDistance = 5;
        this.controls.maxPolarAngle = Math.PI * 0.9;
        
        // Touch-specific settings for iOS
        if (isMobile) {
            this.controls.touches = {
                ONE: THREE.TOUCH.ROTATE,
                TWO: THREE.TOUCH.DOLLY_PAN
            };
            this.controls.rotateSpeed = 0.5;
            this.controls.zoomSpeed = 0.8;
        }
        
        this.controls.update();

        // Lighting
        this.setupLighting();

        // Environment map
        this.setupEnvironment();

        // Handle resize
        window.addEventListener('resize', () => this.onResize());

        // Start render loop
        this.animate();
    }

    /**
     * Check WebGL capabilities and warn about potential issues
     */
    checkWebGLCapabilities() {
        const gl = this.renderer.getContext();
        
        const maxUniforms = gl.getParameter(gl.MAX_VERTEX_UNIFORM_VECTORS);
        const maxTextures = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
        const renderer = gl.getParameter(gl.RENDERER);
        const vendor = gl.getParameter(gl.VENDOR);
        
        console.log('[WebGL] Capabilities:', {
            renderer,
            vendor,
            maxVertexUniforms: maxUniforms,
            maxTextureUnits: maxTextures
        });
        
        // Warn if uniform capacity is low (might affect morph targets)
        if (maxUniforms < 300) {
            console.warn('[WebGL] Low uniform capacity detected. Complex morph target animations may not work correctly.');
            // Could reduce morph target count or use fallback here
        }
        
        // Check for WebGL 2 (better morph target support)
        const isWebGL2 = gl instanceof WebGL2RenderingContext;
        console.log('[WebGL] WebGL 2:', isWebGL2);
        
        return {
            maxUniforms,
            maxTextures,
            isWebGL2,
            renderer,
            vendor
        };
    }

    /**
     * Handle WebGL context loss
     */
    handleContextLoss() {
        // Stop animation loop
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
        }
        
        // Show error to user
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.remove('hidden');
            const text = overlay.querySelector('.loading-text');
            if (text) {
                text.textContent = 'Graphics error - please refresh';
            }
        }
    }

    /**
     * Handle WebGL context restore
     */
    handleContextRestore() {
        // Reinitialize renderer
        this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
        
        // Restart animation
        this.animate();
        
        // Hide overlay
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.classList.add('hidden');
        }
    }

    setupLighting() {
        // Key light - UPDATED: brighter (2.5 from 2.0)
        const keyLight = new THREE.DirectionalLight(0xfff5e6, 2.5);
        keyLight.position.set(2, 3, 2);
        this.scene.add(keyLight);

        // Fill light
        const fillLight = new THREE.DirectionalLight(0xe6f0ff, 0.8);
        fillLight.position.set(-2, 2, 1);
        this.scene.add(fillLight);

        // Rim/back light
        const rimLight = new THREE.DirectionalLight(0xffffff, 0.8);
        rimLight.position.set(0, 2, -3);
        this.scene.add(rimLight);

        // Secondary rim for hair
        const hairRim = new THREE.DirectionalLight(0xffe8d0, 0.4);
        hairRim.position.set(1.5, 2.5, -1);
        this.scene.add(hairRim);

        // Ambient light - UPDATED: slightly brighter (0.45 from 0.4)
        const ambientLight = new THREE.AmbientLight(0x404060, 0.45);
        this.scene.add(ambientLight);

        // Hemisphere light
        const hemiLight = new THREE.HemisphereLight(0xffeeb1, 0x080820, 0.4);
        this.scene.add(hemiLight);

        // Face spotlight
        const faceSpot = new THREE.SpotLight(0xffffff, 0.5);
        faceSpot.position.set(0.5, 2, 1.5);
        faceSpot.angle = Math.PI / 6;
        faceSpot.penumbra = 0.5;
        faceSpot.target.position.set(0, 1.5, 0);
        this.scene.add(faceSpot);
        this.scene.add(faceSpot.target);
    }

    setupEnvironment() {
        const pmremGenerator = new THREE.PMREMGenerator(this.renderer);
        pmremGenerator.compileEquirectangularShader();

        const envScene = new THREE.Scene();

        const topColor = new THREE.Color(0.6, 0.55, 0.5);
        const bottomColor = new THREE.Color(0.1, 0.1, 0.15);
        const middleColor = new THREE.Color(0.3, 0.3, 0.35);

        const envGeom = new THREE.SphereGeometry(50, 32, 32);
        const envMat = new THREE.ShaderMaterial({
            side: THREE.BackSide,
            uniforms: {
                topColor: { value: topColor },
                middleColor: { value: middleColor },
                bottomColor: { value: bottomColor }
            },
            vertexShader: `
                varying vec3 vWorldPosition;
                void main() {
                    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
                    vWorldPosition = worldPosition.xyz;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: `
                uniform vec3 topColor;
                uniform vec3 middleColor;
                uniform vec3 bottomColor;
                varying vec3 vWorldPosition;
                void main() {
                    float h = normalize(vWorldPosition).y;
                    vec3 color;
                    if (h > 0.0) {
                        color = mix(middleColor, topColor, h);
                    } else {
                        color = mix(middleColor, bottomColor, -h);
                    }
                    gl_FragColor = vec4(color, 1.0);
                }
            `
        });

        const envMesh = new THREE.Mesh(envGeom, envMat);
        envScene.add(envMesh);

        const envMap = pmremGenerator.fromScene(envScene, 0.04).texture;
        this.scene.environment = envMap;

        pmremGenerator.dispose();
        envGeom.dispose();
        envMat.dispose();

        console.log('Environment map created');
    }

    async loadModel(url) {
        return new Promise((resolve, reject) => {
            const loader = new GLTFLoader();

            loader.load(
                url,
                (gltf) => {
                    console.log('Model loaded:', gltf);

                    // Clean up previous model
                    if (this.model) {
                        this.scene.remove(this.model);
                    }
                    
                    // Clean up previous animation mixer
                    if (this.mixer) {
                        this.mixer.stopAllAction();
                        this.mixer = null;
                    }
                    
                    // Stop previous idle movement
                    this.stopIdleMovement();
                    
                    // Stop previous expression system
                    if (this.expressionSystem) {
                        this.expressionSystem.stop();
                        this.expressionSystem = null;
                    }
                    
                    // Clear bone references
                    this.bones = {};

                    this.model = gltf.scene;

                    // Center and position
                    const box = new THREE.Box3().setFromObject(this.model);
                    const center = box.getCenter(new THREE.Vector3());
                    this.model.position.x = -center.x;
                    this.model.position.z = -center.z;
                    this.model.position.y = -box.min.y;

                    this.scene.add(this.model);

                    // Build morphTargetDictionary
                    this.model.traverse((node) => {
                        if (node.isMesh) {
                            if (node.userData?.targetNames && Array.isArray(node.userData.targetNames)) {
                                node.morphTargetDictionary = {};
                                node.userData.targetNames.forEach((name, index) => {
                                    node.morphTargetDictionary[name] = index;
                                });
                                const visemes = Object.keys(node.morphTargetDictionary).filter(k => k.includes('viseme'));
                                if (visemes.length > 0) {
                                    console.log(`Built morphTargetDictionary for ${node.name}: ${visemes.length} visemes`);
                                }
                            }
                        }
                    });

                    // UPGRADE ALL MATERIALS
                    this.upgradeMaterials();

                    // APPLY JAW CORRECTION
                    this.applyJawCorrection(0.7);

                    // Check if model has animations
                    const hasAnimation = gltf.animations && gltf.animations.length > 0;
                    
                    // Animation mixer (if model has animations)
                    if (hasAnimation) {
                        this.mixer = new THREE.AnimationMixer(this.model);
                        const idleAction = this.mixer.clipAction(gltf.animations[0]);
                        idleAction.play();
                        console.log('Playing animation:', gltf.animations[0].name);
                    } else {
                        console.log('No embedded animation - will apply static pose');
                    }

                    // Initialize viseme mapper
                    if (window.VisemeMapper) {
                        const success = window.VisemeMapper.initialize(this.model);
                        if (!success) {
                            console.warn('No visemes found in model');
                        }
                    }

                    if (window.BlendShapeMapper) {
                        window.BlendShapeMapper.initialize(this.model);
                    }

                    this.setupBones();
                    
                    // For models without animation, apply relaxed pose
                    if (!hasAnimation) {
                        this.applyRelaxedPose();
                    }

                    // Store head mesh reference
                    this.model.traverse((node) => {
                        if (node.name === 'Head_Mesh') {
                            this.headMesh = node;
                            window.headMesh = node;
                        }
                    });

                    // Initialize expression system
                    this.expressionSystem = new ExpressionSystem(this.headMesh);
                    this.expressionSystem.start();

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
     * Apply inverse jawForward to base geometry to fix underbite
     * @param {number} strength - How much to pull jaw back (0-1)
     */
    applyJawCorrection(strength = 0.7) {
        const applyToMesh = (mesh) => {
            if (!mesh || !mesh.geometry || !mesh.morphTargetDictionary) return false;

            const geo = mesh.geometry;
            const posAttr = geo.attributes.position;
            const jawIdx = mesh.morphTargetDictionary['jawForward'];

            if (jawIdx === undefined || !geo.morphAttributes.position) return false;

            const jawMorph = geo.morphAttributes.position[jawIdx];
            if (!jawMorph) return false;

            // Subtract the morph delta from base positions
            for (let i = 0; i < posAttr.count; i++) {
                posAttr.array[i * 3] -= jawMorph.array[i * 3] * strength;
                posAttr.array[i * 3 + 1] -= jawMorph.array[i * 3 + 1] * strength;
                posAttr.array[i * 3 + 2] -= jawMorph.array[i * 3 + 2] * strength;
            }

            posAttr.needsUpdate = true;
            geo.computeVertexNormals();
            return true;
        };

        let headMesh = null, teethMesh = null;
        this.model.traverse(obj => {
            if (obj.name === 'Head_Mesh') headMesh = obj;
            if (obj.name === 'Teeth_Mesh') teethMesh = obj;
        });

        const headResult = applyToMesh(headMesh);
        const teethResult = applyToMesh(teethMesh);

        console.log(`Jaw correction applied (strength ${strength}): head=${headResult}, teeth=${teethResult}`);
    }

    upgradeMaterials() {
        if (!this.materialSettings.enabled) {
            console.log('Material upgrades disabled');
            return;
        }

        const meshHandlers = {
            'Head_Mesh': (mesh) => this.upgradeSkinMaterial(mesh),
            'Body_Mesh': (mesh) => this.upgradeSkinMaterial(mesh),
            'Eye_Mesh': (mesh) => this.upgradeEyeMaterial(mesh),
            'EyeAO_Mesh': (mesh) => this.upgradeEyeAOMaterial(mesh),
            'Teeth_Mesh': (mesh) => this.upgradeTeethMaterial(mesh),
            'Tongue_Mesh': (mesh) => this.upgradeTongueMaterial(mesh),
            'Eyelash_Mesh': (mesh) => this.upgradeEyelashMaterial(mesh),
        };

        const isHairMesh = (name) => name.startsWith('avaturn_hair');

        this.model.traverse((node) => {
            if (!node.isMesh) return;

            const handler = meshHandlers[node.name];
            if (handler) {
                handler(node);
            } else if (isHairMesh(node.name)) {
                this.upgradeHairMaterial(node);
            } else {
                this.upgradeGenericMaterial(node);
            }
        });

        console.log('All materials upgraded');
    }

    upgradeSkinMaterial(mesh) {
        const oldMat = mesh.material;
        const s = this.materialSettings.skin;

        const newMat = new THREE.MeshPhysicalMaterial({
            map: oldMat.map,
            normalMap: oldMat.normalMap,
            roughnessMap: oldMat.roughnessMap,
            metalnessMap: oldMat.metalnessMap,
            aoMap: oldMat.aoMap,
            color: oldMat.color || new THREE.Color(1, 1, 1),
            metalness: 0.0,
            roughness: s.roughness,
            clearcoat: s.clearcoat,
            clearcoatRoughness: s.clearcoatRoughness,
            sheen: s.sheen,
            sheenRoughness: s.sheenRoughness,
            sheenColor: s.sheenColor,
            envMapIntensity: s.envMapIntensity,
            normalScale: oldMat.normalScale || new THREE.Vector2(1, 1),
            side: oldMat.side || THREE.FrontSide,
            transparent: oldMat.transparent || false,
            alphaTest: oldMat.alphaTest || 0,
            morphTargets: true,
            morphNormals: true,
        });

        mesh.material = newMat;
        mesh.material.needsUpdate = true;
        oldMat.dispose();

        console.log(`✓ ${mesh.name}: Skin material`);
    }

    upgradeEyeMaterial(mesh) {
        const oldMat = mesh.material;
        const s = this.materialSettings.eyes;

        const newMat = new THREE.MeshPhysicalMaterial({
            map: oldMat.map,
            normalMap: oldMat.normalMap,
            roughnessMap: oldMat.roughnessMap,
            color: oldMat.color || new THREE.Color(1, 1, 1),
            metalness: 0.0,
            roughness: s.roughness,
            clearcoat: s.clearcoat,
            clearcoatRoughness: s.clearcoatRoughness,
            ior: s.ior,
            envMapIntensity: s.envMapIntensity,
            side: oldMat.side || THREE.FrontSide,
            transparent: oldMat.transparent || false,
            morphTargets: true,
            morphNormals: true,
        });

        mesh.material = newMat;
        mesh.material.needsUpdate = true;
        oldMat.dispose();

        console.log(`✓ ${mesh.name}: Eye material`);
    }

    upgradeEyeAOMaterial(mesh) {
        const oldMat = mesh.material;
        const s = this.materialSettings.eyeAO;

        const newMat = new THREE.MeshPhysicalMaterial({
            map: oldMat.map,
            normalMap: oldMat.normalMap,
            roughnessMap: oldMat.roughnessMap,
            color: oldMat.color || new THREE.Color(1, 1, 1),
            metalness: 0.0,
            roughness: s.roughness,
            clearcoat: s.clearcoat,
            envMapIntensity: s.envMapIntensity,
            side: oldMat.side || THREE.DoubleSide,
            transparent: oldMat.transparent || true,
            alphaMap: oldMat.alphaMap,
            alphaTest: oldMat.alphaTest || 0,
            morphTargets: true,
            morphNormals: true,
        });

        mesh.material = newMat;
        mesh.material.needsUpdate = true;
        oldMat.dispose();

        console.log(`✓ ${mesh.name}: Eye AO material`);
    }

    upgradeTeethMaterial(mesh) {
        const oldMat = mesh.material;
        const s = this.materialSettings.teeth;

        const newMat = new THREE.MeshPhysicalMaterial({
            map: oldMat.map,
            normalMap: oldMat.normalMap,
            roughnessMap: oldMat.roughnessMap,
            aoMap: oldMat.aoMap,
            color: oldMat.color || new THREE.Color(1, 1, 1),
            metalness: 0.0,
            roughness: s.roughness,
            clearcoat: s.clearcoat,
            clearcoatRoughness: s.clearcoatRoughness,
            sheen: s.sheen,
            sheenRoughness: s.sheenRoughness,
            sheenColor: s.sheenColor,
            envMapIntensity: s.envMapIntensity,
            side: THREE.DoubleSide,
            morphTargets: true,
            morphNormals: true,
        });

        mesh.material = newMat;
        mesh.material.needsUpdate = true;
        oldMat.dispose();

        console.log(`✓ ${mesh.name}: Teeth material`);
    }

    upgradeTongueMaterial(mesh) {
        const oldMat = mesh.material;
        const s = this.materialSettings.tongue;

        const newMat = new THREE.MeshPhysicalMaterial({
            map: oldMat.map,
            normalMap: oldMat.normalMap,
            roughnessMap: oldMat.roughnessMap,
            color: oldMat.color || new THREE.Color(1, 1, 1),
            metalness: 0.0,
            roughness: s.roughness,
            clearcoat: s.clearcoat,
            clearcoatRoughness: s.clearcoatRoughness,
            sheen: s.sheen,
            sheenRoughness: s.sheenRoughness,
            sheenColor: s.sheenColor,
            envMapIntensity: s.envMapIntensity,
            side: THREE.DoubleSide,
            morphTargets: true,
            morphNormals: true,
        });

        mesh.material = newMat;
        mesh.material.needsUpdate = true;
        oldMat.dispose();

        console.log(`✓ ${mesh.name}: Tongue material`);
    }

    upgradeHairMaterial(mesh) {
        const oldMat = mesh.material;
        const s = this.materialSettings.hair;

        let hairColor = oldMat.color ? oldMat.color.clone() : new THREE.Color(0.15, 0.1, 0.08);
        const sheenColor = s.sheenColor || hairColor.clone().lerp(new THREE.Color(1, 0.9, 0.8), 0.3);

        const newMat = new THREE.MeshPhysicalMaterial({
            map: oldMat.map,
            normalMap: oldMat.normalMap,
            roughnessMap: oldMat.roughnessMap,
            alphaMap: oldMat.alphaMap,
            color: hairColor,
            metalness: 0.0,
            roughness: s.roughness,
            anisotropy: s.anisotropy,
            anisotropyRotation: s.anisotropyRotation,
            sheen: s.sheen,
            sheenRoughness: s.sheenRoughness,
            sheenColor: sheenColor,
            clearcoat: s.clearcoat,
            clearcoatRoughness: s.clearcoatRoughness,
            envMapIntensity: s.envMapIntensity,
            transparent: true,
            alphaTest: oldMat.alphaTest || 0.5,
            side: THREE.DoubleSide,
            depthWrite: true,
            morphTargets: true,
            morphNormals: true,
        });

        mesh.material = newMat;
        mesh.material.needsUpdate = true;
        mesh.renderOrder = 1;

        oldMat.dispose();

        console.log(`✓ ${mesh.name}: Hair material (anisotropic)`);
    }

    upgradeEyelashMaterial(mesh) {
        const oldMat = mesh.material;
        const s = this.materialSettings.eyelashes;

        const newMat = new THREE.MeshPhysicalMaterial({
            map: oldMat.map,
            normalMap: oldMat.normalMap,
            alphaMap: oldMat.alphaMap,
            color: oldMat.color || new THREE.Color(0.05, 0.03, 0.03),
            metalness: 0.0,
            roughness: s.roughness,
            sheen: s.sheen,
            sheenRoughness: s.sheenRoughness,
            sheenColor: s.sheenColor,
            clearcoat: s.clearcoat,
            envMapIntensity: s.envMapIntensity,
            transparent: s.transparent,
            alphaTest: s.alphaTest,
            side: THREE.DoubleSide,
            depthWrite: true,
            morphTargets: true,
            morphNormals: true,
        });

        mesh.material = newMat;
        mesh.material.needsUpdate = true;
        mesh.renderOrder = 2;

        oldMat.dispose();

        console.log(`✓ ${mesh.name}: Eyelash material`);
    }

    upgradeGenericMaterial(mesh) {
        if (mesh.morphTargetInfluences) {
            mesh.material.morphTargets = true;
            mesh.material.morphNormals = true;
            mesh.material.needsUpdate = true;
        }

        if (mesh.material.isMeshStandardMaterial) {
            mesh.material.envMapIntensity = 0.5;
        }

        console.log(`  ${mesh.name}: Generic (morph targets enabled)`);
    }

    updateMaterialSettings(category, settings) {
        if (this.materialSettings[category]) {
            Object.assign(this.materialSettings[category], settings);
        }

        const categoryMeshes = {
            skin: ['Head_Mesh', 'Body_Mesh'],
            eyes: ['Eye_Mesh'],
            eyeAO: ['EyeAO_Mesh'],
            teeth: ['Teeth_Mesh'],
            tongue: ['Tongue_Mesh'],
            eyelashes: ['Eyelash_Mesh'],
            hair: [],
        };

        const targetMeshes = categoryMeshes[category] || [];
        const isHairCategory = category === 'hair';

        this.model?.traverse((node) => {
            if (!node.isMesh) return;

            const isTarget = targetMeshes.includes(node.name) ||
                (isHairCategory && node.name.startsWith('avaturn_hair'));

            if (isTarget && node.material.isMeshPhysicalMaterial) {
                const mat = node.material;
                const s = this.materialSettings[category];

                if (s.clearcoat !== undefined) mat.clearcoat = s.clearcoat;
                if (s.clearcoatRoughness !== undefined) mat.clearcoatRoughness = s.clearcoatRoughness;
                if (s.roughness !== undefined) mat.roughness = s.roughness;
                if (s.sheen !== undefined) mat.sheen = s.sheen;
                if (s.sheenRoughness !== undefined) mat.sheenRoughness = s.sheenRoughness;
                if (s.sheenColor) mat.sheenColor.copy(s.sheenColor);
                if (s.envMapIntensity !== undefined) mat.envMapIntensity = s.envMapIntensity;
                if (s.anisotropy !== undefined) mat.anisotropy = s.anisotropy;
                if (s.anisotropyRotation !== undefined) mat.anisotropyRotation = s.anisotropyRotation;
                if (s.ior !== undefined) mat.ior = s.ior;

                mat.needsUpdate = true;
            }
        });

        console.log(`Updated ${category} settings:`, settings);
    }

    focusOnFace() {
        if (!this.model) return;

        const box = new THREE.Box3().setFromObject(this.model);
        const height = box.max.y - box.min.y;
        
        // Target chest/upper body area (about 65% up from ground)
        const targetY = height * 0.65;

        // Model faces forward with rotation = 0
        this.model.rotation.y = 0;

        // Camera: centered (x=0), at chest height, pulled back (z=2.2) for wider shot
        this.camera.position.set(0, targetY, 2.2);
        this.controls.target.set(0, targetY, 0);
        this.camera.up.set(0, 1, 0);
        this.camera.lookAt(0, targetY, 0);
        this.controls.update();

        console.log('Camera positioned for full body view');
    }

    setupBones() {
        this.model.traverse((node) => {
            if (node.isBone) {
                this.bones[node.name] = node;
            }
        });

        console.log('Found bones:', Object.keys(this.bones).length);
        this.positionArms();
    }

    positionArms() {
        // Basic arm positioning - works for both animated and non-animated models
        // For animated models, this may be overridden by the animation
        if (this.bones.LeftShoulder) {
            this.bones.LeftShoulder.rotation.set(1.6, 0, -1.3);
        }
        if (this.bones.RightShoulder) {
            this.bones.RightShoulder.rotation.set(1.6, 0, 1.3);
        }
        if (this.bones.LeftArm) {
            this.bones.LeftArm.rotation.set(1.5, 0, -0.15);
        }
        if (this.bones.RightArm) {
            this.bones.RightArm.rotation.set(1.5, 0, 0.15);
        }
        if (this.bones.LeftForeArm) {
            this.bones.LeftForeArm.rotation.set(0, 0, 0);
        }
        if (this.bones.RightForeArm) {
            this.bones.RightForeArm.rotation.set(0, 0, 0);
        }

        console.log('Arms positioned: relaxed pose');
    }

    /**
     * Apply a more relaxed, natural pose for models without embedded animation
     * This creates a gentle, approachable stance
     */
    applyRelaxedPose() {
        console.log('Applying relaxed pose for non-animated model...');
        
        // Shoulders - drop them down and slightly forward for relaxed look
        if (this.bones.LeftShoulder) {
            this.bones.LeftShoulder.rotation.set(1.55, 0.05, -1.25);
        }
        if (this.bones.RightShoulder) {
            this.bones.RightShoulder.rotation.set(1.55, -0.05, 1.25);
        }
        
        // Upper arms - relaxed at sides, slightly forward
        if (this.bones.LeftArm) {
            this.bones.LeftArm.rotation.set(1.4, 0.1, -0.2);
        }
        if (this.bones.RightArm) {
            this.bones.RightArm.rotation.set(1.4, -0.1, 0.2);
        }
        
        // Forearms - slight bend for natural look
        if (this.bones.LeftForeArm) {
            this.bones.LeftForeArm.rotation.set(0.15, 0.1, 0.05);
        }
        if (this.bones.RightForeArm) {
            this.bones.RightForeArm.rotation.set(0.15, -0.1, -0.05);
        }
        
        // Hands - natural slight curl
        if (this.bones.LeftHand) {
            this.bones.LeftHand.rotation.set(0, 0, 0.1);
        }
        if (this.bones.RightHand) {
            this.bones.RightHand.rotation.set(0, 0, -0.1);
        }
        
        // Spine - very slight forward lean for approachable posture
        if (this.bones.Spine) {
            this.bones.Spine.rotation.x += 0.02;
        }
        if (this.bones.Spine1) {
            this.bones.Spine1.rotation.x += 0.01;
        }
        
        // Head - very slight tilt for engagement
        if (this.bones.Head) {
            this.bones.Head.rotation.x += 0.03;  // Slight nod forward
            this.bones.Head.rotation.z = 0.02;   // Very slight tilt
        }
        
        // Neck - natural position
        if (this.bones.Neck) {
            this.bones.Neck.rotation.x -= 0.02;
        }
        
        console.log('Relaxed pose applied');
        
        // Start subtle idle movement for non-animated models
        this.startIdleMovement();
    }
    
    /**
     * Subtle procedural idle movement for models without embedded animation
     * Creates gentle breathing-like motion and micro-movements
     */
    startIdleMovement() {
        if (this.idleMovementInterval) {
            clearInterval(this.idleMovementInterval);
        }
        
        const startTime = performance.now();
        
        // Store original positions for oscillation
        const originalSpineX = this.bones.Spine?.rotation.x || 0;
        const originalSpine1X = this.bones.Spine1?.rotation.x || 0;
        const originalHeadX = this.bones.Head?.rotation.x || 0;
        const originalHeadZ = this.bones.Head?.rotation.z || 0;
        const originalLeftShoulderZ = this.bones.LeftShoulder?.rotation.z || 0;
        const originalRightShoulderZ = this.bones.RightShoulder?.rotation.z || 0;
        
        const animate = () => {
            if (!this.model || this.mixer) {
                // Stop if model removed or animation mixer takes over
                cancelAnimationFrame(this.idleAnimationFrame);
                return;
            }
            
            const elapsed = (performance.now() - startTime) / 1000;
            
            // Breathing cycle (~4 seconds)
            const breathCycle = Math.sin(elapsed * 1.5) * 0.008;
            
            // Slower sway cycle (~8 seconds)
            const swayCycle = Math.sin(elapsed * 0.8) * 0.01;
            
            // Very slow head movement (~12 seconds)
            const headCycle = Math.sin(elapsed * 0.5) * 0.015;
            
            // Apply breathing to spine
            if (this.bones.Spine) {
                this.bones.Spine.rotation.x = originalSpineX + breathCycle;
            }
            if (this.bones.Spine1) {
                this.bones.Spine1.rotation.x = originalSpine1X + breathCycle * 0.7;
            }
            
            // Apply subtle sway to shoulders
            if (this.bones.LeftShoulder) {
                this.bones.LeftShoulder.rotation.z = originalLeftShoulderZ + swayCycle * 0.3;
            }
            if (this.bones.RightShoulder) {
                this.bones.RightShoulder.rotation.z = originalRightShoulderZ - swayCycle * 0.3;
            }
            
            // Apply subtle head movement
            if (this.bones.Head) {
                this.bones.Head.rotation.x = originalHeadX + headCycle * 0.5;
                this.bones.Head.rotation.z = originalHeadZ + Math.sin(elapsed * 0.3) * 0.008;
            }
            
            this.idleAnimationFrame = requestAnimationFrame(animate);
        };
        
        this.idleAnimationFrame = requestAnimationFrame(animate);
        console.log('Idle movement started for non-animated model');
    }
    
    /**
     * Stop idle movement (called when switching models or disposing)
     */
    stopIdleMovement() {
        if (this.idleAnimationFrame) {
            cancelAnimationFrame(this.idleAnimationFrame);
            this.idleAnimationFrame = null;
        }
    }

    onResize() {
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();

        if (this.mixer) {
            this.mixer.update(delta);
        }

        this.controls.update();
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

    getFps() {
        return this.currentFps;
    }

    dispose() {
        if (this.expressionSystem) {
            this.expressionSystem.stop();
        }
        this.stopIdleMovement();
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
        this.currentExpressions = {};

        this.expressions = {
            eyeBlinkLeft: 'eyeBlinkLeft',
            eyeBlinkRight: 'eyeBlinkRight',
            eyesClosed: 'eyesClosed',
            browDownLeft: 'browDownLeft',
            browDownRight: 'browDownRight',
            browInnerUp: 'browInnerUp',
            browOuterUpLeft: 'browOuterUpLeft',
            browOuterUpRight: 'browOuterUpRight',
            eyeSquintLeft: 'eyeSquintLeft',
            eyeSquintRight: 'eyeSquintRight',
            eyeWideLeft: 'eyeWideLeft',
            eyeWideRight: 'eyeWideRight',
            mouthSmileLeft: 'mouthSmileLeft',
            mouthSmileRight: 'mouthSmileRight',
            mouthFrownLeft: 'mouthFrownLeft',
            mouthFrownRight: 'mouthFrownRight',
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
        this.startBlinking();
        this.startMicroExpressions();
        console.log('ExpressionSystem started');
    }

    stop() {
        this.isRunning = false;
        if (this.blinkInterval) clearTimeout(this.blinkInterval);
        if (this.microExpressionInterval) clearTimeout(this.microExpressionInterval);
    }

    startBlinking() {
        const blink = () => {
            if (!this.isRunning) return;

            this.animateExpression(['eyeBlinkLeft', 'eyeBlinkRight'], 1.0, 150, () => {
                this.animateExpression(['eyeBlinkLeft', 'eyeBlinkRight'], 0, 100);
            });

            const nextBlink = 2000 + Math.random() * 4000;
            this.blinkInterval = setTimeout(blink, nextBlink);
        };

        this.blinkInterval = setTimeout(blink, 1000 + Math.random() * 2000);
    }

    startMicroExpressions() {
        const microExpressions = [
            () => {
                this.animateExpression(['browInnerUp'], 0.3, 400, () => {
                    setTimeout(() => this.animateExpression(['browInnerUp'], 0, 600), 800);
                });
            },
            () => {
                this.animateExpression(['eyeSquintLeft', 'eyeSquintRight'], 0.2, 300, () => {
                    setTimeout(() => this.animateExpression(['eyeSquintLeft', 'eyeSquintRight'], 0, 400), 600);
                });
            },
            () => {
                this.animateExpression(['mouthSmileLeft', 'mouthSmileRight'], 0.15, 500, () => {
                    setTimeout(() => this.animateExpression(['mouthSmileLeft', 'mouthSmileRight'], 0, 700), 1000);
                });
            },
            () => {
                const side = Math.random() > 0.5 ? 'browOuterUpLeft' : 'browOuterUpRight';
                this.animateExpression([side], 0.4, 300, () => {
                    setTimeout(() => this.animateExpression([side], 0, 400), 500);
                });
            }
        ];

        const doMicroExpression = () => {
            if (!this.isRunning) return;

            const expr = microExpressions[Math.floor(Math.random() * microExpressions.length)];
            expr();

            const nextExpr = 3000 + Math.random() * 5000;
            this.microExpressionInterval = setTimeout(doMicroExpression, nextExpr);
        };

        this.microExpressionInterval = setTimeout(doMicroExpression, 2000 + Math.random() * 2000);
    }

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

    setExpression(name, value) {
        if (!this.headMesh) return;
        const dict = this.headMesh.morphTargetDictionary;
        if (dict[name] !== undefined) {
            this.headMesh.morphTargetInfluences[dict[name]] = value;
        }
    }

    showInterest() {
        this.animateExpression(['browInnerUp', 'eyeWideLeft', 'eyeWideRight'], 0.3, 200);
        setTimeout(() => {
            this.animateExpression(['browInnerUp', 'eyeWideLeft', 'eyeWideRight'], 0, 500);
        }, 1000);
    }

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
