// Import dependencies
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass";
import { SphericalMercator } from "../sm";
import { getBaseLog, resolveSeams, slashify } from "../utilities";
import getPixels from "get-pixels";
import updatetileworker from "workerize-loader!../workers/updatetile"; // eslint-disable-line import/no-webpack-loader-syntax
import parseelevationworker from "workerize-loader!../workers/parseelevationworker"; // eslint-disable-line import/no-webpack-loader-syntax
import { CustomOutlinePass } from "./CustomOutlinePass.js";

export default function ThreeEntryPoint(sceneRef) {
    var basePlaneDimension = 65024;
    var mercator = new SphericalMercator({ size: basePlaneDimension });

    let debugMode = false;
    var firstTime = true;
    var meshes = 0;
    var parserRequests = 0;
    var updaterRequests = 0;
    var finished = 0;
    //compass functionality
    var pivot = document.querySelector("#grid");
    var compass = document.querySelector("#compass img");
    var screenPosition;
    function updateCompass(reset, azimuth, pitch) {
        var styling;

        if (reset === true) {
            var currentPos = controls.target;
            camera.position.x = currentPos.x;
            camera.position.z = currentPos.z;
            // controls.setAzimuthalAngle(azimuth * Math.PI / 180);
            // controls.setPolarAngle(pitch * Math.PI / 180);
            controls.autoRotate = false;
            styling = "";
        } else {
            var angle = (controls.getAzimuthalAngle() * 180) / Math.PI;
            var pitch = (controls.getPolarAngle() * 180) / Math.PI;
            // styling =
            // "rotateX(" + pitch + "deg) rotateZ(" + angle + "deg)";
        }
        // compass.style["-webkit-transform"] = styling;
        // pivot.style["-webkit-transform"] = styling;
        // pivot.style["display"] = "block";
    }

    //set up scene
    var width = window.innerWidth,
        height = window.innerHeight;
    var scene = new THREE.Scene();

    //set up renderer
    var renderer = new THREE.WebGLRenderer({ alpha: false });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // default THREE.PCFShadowMap
    // renderer.setPixelRatio( window.devicePixelRatio );
    sceneRef.appendChild(renderer.domElement);
    function render() {
        if (tilesToGet !== 0) {
            requestAnimationFrame(render);
        }
        // renderer.render(scene, camera);
        composer.render();
    }
    //set up camera

    var camera = new THREE.PerspectiveCamera(
        75,
        width / height,
        1 / 99,
        100000000000000
    );
    camera.position.y = 1200;
    // const ambientLight = new THREE.AmbientLight( 0xffffff, 0.3 );
    // scene.add( ambientLight );

    // const light1 = new THREE.PointLight( 0xffffff, 1, 0 );
    // scene.add( light1 );
    let needsUpdate, lastMove;
    function handleControlUpdate() {
        // light1.position.set( camera.position.x, camera.position.y , camera.position.z );
        lastMove = Date.now();
        if (!needsUpdate) {
            needsUpdate = setInterval(function (time) {
                if (Date.now() - lastMove < 150) return;
                else {
                    updateTiles();
                    clearInterval(needsUpdate);
                    needsUpdate = false;
                }
            });
        }
    }
    var controls = new OrbitControls(camera, renderer.domElement);
    // controls.maxPolarAngle = Math.PI * 0.495;
    // controls.target.set(0, 10, 0);
    // controls.minDistance = 10.0;
    // controls.maxDistance = 100.0;
    controls.addEventListener("change", handleControlUpdate); // use if there is no animation loop

    // postprocessing
    const depthTexture = new THREE.DepthTexture();
    const renderTarget = new THREE.WebGLRenderTarget(
        window.innerWidth,
        window.innerHeight,
        {
            depthTexture: depthTexture,
            depthBuffer: true,
        }
    );
    const composer = new EffectComposer(renderer, renderTarget);
    const renderPass = new RenderPass(scene, camera);
    composer.addPass(renderPass);

    const customOutline = new CustomOutlinePass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        scene,
        camera
    );
    composer.addPass(customOutline);

    renderer.setSize(width, height);
    composer.setSize(width, height);
    render();

    var raycaster = new THREE.Raycaster();

    // raycaster.far = 10000;

    function getZoom() {
        var pt = controls.target.distanceTo(controls.object.position);
        return Math.min(Math.max(getBaseLog(0.5, pt / 12000) + 4, 0), 11);
    }

    var tilesToGet = 0;
    var inspectElevation = false;

    function assembleUrl(img, coords) {
        if (!img) {
            return `http://192.168.1.45:8080/data/BDALTIV2_75M_rvb/${slashify(
                coords
            )}.png`;
        }
        var tileset = img ? "mapbox.streets-satellite" : "mapbox.terrain-rgb"; //
        var res = img ? "@2x.png" : "@2x.pngraw";

        //domain sharding
        var serverIndex = Math.floor((coords[1] % 3) + (coords[2] % 3) / 3);
        var server = ["a", "b", "c"][serverIndex];
        //return 'sample.png'
        return (
            "https://" +
            server +
            ".tile.openstreetmap.fr/osmfr/" +
            slashify(coords) +
            ".png"
        );
    }

    var basePlane = new THREE.PlaneBufferGeometry(
        basePlaneDimension * 100,
        basePlaneDimension * 100,
        1,
        1
    );

    var mat = new THREE.MeshBasicMaterial({
        wireframe: true,
        opacity: 0,
        //transparent: true
    });

    var plane = new THREE.Mesh(basePlane, mat);
    plane.rotation.x = -0.5 * Math.PI;
    plane.opacity = 0;
    scene.add(plane);

    // calculates which tiles are in view to download
    var updater = new updatetileworker();

    //converts RGB values to elevation
    var parserPool = [];

    for (var p = 0; p < 4; p++) {
        var parser = new parseelevationworker();

        // whenever parser returns a mesh, make mesh

        parserPool.push(parser);
    }

    //initial tile load
    // window.setTimeout(function () {
    //     updateCompass(true, 0, 90);
    // }, 500);

    function updateTiles() {
        zoom = Math.floor(getZoom());

        var ul = { x: -1, y: -1, z: -1 };
        var ur = { x: 1, y: -1, z: -1 };
        var lr = { x: 1, y: 1, z: 1 };
        var ll = { x: -1, y: 1, z: 1 };

        var corners = [ul, ur, lr, ll, ul].map(function (corner) {
            raycaster.setFromCamera(corner, camera);
            const r = raycaster.intersectObject(plane)[0];
            if (r) {
                return r.point;
            }
            return screenPosition;
        });

        if (corners[0] === screenPosition) return;
        else screenPosition = corners[0];

        console.log("corners", corners);
        updater.onMessage([zoom, corners]).then((cb) => {
            console.log("updatetileworker", cb);
            var queue = cb.getTiles[0].length;

            if (queue > 0) {
                getTiles(cb.getTiles);
                updateTileVisibility();
            }
        });

        // setHash()
    }

    // given a list of elevation and imagery tiles, download
    function getTiles([tiles, elevation]) {
        tiles = tiles.map(function (tile) {
            return slashify(tile);
        });

        tilesToGet += tiles.length;
        render();
        updaterRequests += tiles.length;

        elevation.forEach(function (coords) {
            //download the elevation image
            getPixels(
                assembleUrl(null, coords),

                function (err, pixels) {
                    // usually a water tile-- fill with 0 elevation
                    if (err) pixels = null;
                    var parserIndex = 2 * (coords[1] % 2) + (coords[2] % 2);
                    parserPool[parserIndex]
                        .onMessage([pixels, coords, tiles, parserIndex])
                        .then((meshes) => {
                            console.log("parseelevationworker", meshes);
                            parserRequests++;
                            meshes.forEach((m) => makeMesh(m));
                        });
                }
            );
        });
    }

    function generateTexture(data, width, height) {
        let context, image, imageData, shade;

        const vector3 = new THREE.Vector3(0, 0, 0);

        const sun = new THREE.Vector3(1, 1, 1);
        sun.normalize();

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        context = canvas.getContext("2d");
        context.fillStyle = "#000";
        context.fillRect(0, 0, width, height);

        image = context.getImageData(0, 0, canvas.width, canvas.height);
        imageData = image.data;

        for (let i = 0, j = 0, l = imageData.length; i < l; i += 4, j++) {
            vector3.x = data[j - 2] - data[j + 2];
            vector3.y = 2;
            vector3.z = data[j - width * 2] - data[j + width * 2];
            vector3.normalize();

            shade = vector3.dot(sun);

            imageData[i] = (96 + shade * 128) * (0.5 + data[j] * 0.007);
            imageData[i + 1] = (32 + shade * 96) * (0.5 + data[j] * 0.007);
            imageData[i + 2] = shade * 96 * (0.5 + data[j] * 0.007);
        }

        context.putImageData(image, 0, 0);

        // Scaled 4x

        const canvasScaled = document.createElement("canvas");
        canvasScaled.width = width * 4;
        canvasScaled.height = height * 4;

        context = canvasScaled.getContext("2d");
        context.scale(4, 4);
        context.drawImage(canvas, 0, 0);

        image = context.getImageData(
            0,
            0,
            canvasScaled.width,
            canvasScaled.height
        );
        imageData = image.data;

        for (let i = 0, l = imageData.length; i < l; i += 4) {
            const v = ~~(Math.random() * 5);

            imageData[i] += v;
            imageData[i + 1] += v;
            imageData[i + 2] += v;
        }

        context.putImageData(image, 0, 0);

        return canvasScaled;
    }

    const meshMaterial = new THREE.MeshBasicMaterial({
        flatShading: true,
        color: 0x000000,
    });

    function makeMesh([data, [z, x, y]]) {
        meshes++;

        var tileSize = basePlaneDimension / Math.pow(2, z);
        var vertices = 128;
        var segments = vertices - 1;

        // get image to drape
        // var texture = new THREE.TextureLoader().load(
        // url
        // assembleUrl(true, [z, x, y]),

        // callback function
        // function (err, resp) {
        tilesToGet--;
        finished++;

        // scene.remove(placeholder);
        // plane.visible = true;

        if (tilesToGet === 0) {
            // document.querySelector('#progress').style.opacity = 0;
            console.log("STABLE");
            updateTileVisibility();
        }
        // }
        // );
        data = resolveSeams(scene, data, [z, x, y]);

        // var texture = new THREE.DataTexture( new Float32Array(data), tileSize, tileSize , THREE.DepthFormat, THREE.FloatType);

        var geometry = new THREE.PlaneBufferGeometry(
            tileSize,
            tileSize,
            segments,
            segments
        );
        geometry.attributes.position.array = new Float32Array(data);

        // after only mergeVertices my textrues were turning black so this fixed normals issues
        geometry.computeVertexNormals();

        var plane = new THREE.Mesh(geometry, meshMaterial);

        plane.coords = slashify([z, x, y]);
        plane.zoom = z;
        scene.add(plane);
    }

    var zoom = getZoom();

    // lngLat to scene coordinates (as intersecting with plane)
    function project(lnglat) {
        var px = mercator.px(lnglat, 0);
        px = {
            x: px[0] - basePlaneDimension / 2,
            y: 0,
            z: px[1] - basePlaneDimension / 2,
        };
        return px;
    }
    function toggleElevation() {
        inspectElevation = !inspectElevation;
        var className = inspectElevation ? "elev" : "";
        document.querySelector("#webgl").className = className;
    }

    function moveTo(coords, currentHeight) {
        controls.target.copy(coords);
        controls.object.position.copy({
            x: coords.x,
            y: currentHeight,
            z: coords.z,
        });
        setTimeout(function () {
            updateTiles(true);
        }, 10);
    }
    function setCenter(lnglat) {
        var pxCoords = project(lnglat);
        camera.position.x = pxCoords.x;
        camera.position.z = pxCoords.z;
        camera.position.y = 10.629295137280347;
        light1.position.set(
            camera.position.x,
            camera.position.y,
            camera.position.z
        );

        moveTo(pxCoords, camera.position.y);
        window.setTimeout(function () {
            updateTiles();
        }, 100);
        updateCompass(true, 0, 70);
    }

    window.addEventListener("resize", onWindowResize, false);

    function onWindowResize() {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
        updateTiles();
    }

    function updateTileVisibility() {
        var zoom = Math.floor(getZoom());
        //update tile visibility based on zoom
        for (var s = 0; s < scene.children.length; s++) {
            var child = scene.children[s];
            if (child.zoom === zoom || child.zoom === undefined)
                child.visible = true;
            else child.visible = false;
        }
    }
    setCenter([5.722387, 45.171547]);
}