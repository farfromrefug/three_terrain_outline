import { SphericalMercator } from "../sm";
import * as cover from "../tilecover";
var basePlaneDimension = 65024;
var mercator = new SphericalMercator({ size: basePlaneDimension });

function unproject(pt) {
    var lngLat = mercator.ll(
        [pt.x + basePlaneDimension / 2, pt.y + basePlaneDimension / 2],
        0
    );
    return lngLat;
}

function degToRad(v) {
    return v * (Math.PI / 180);
}
function radToDeg(v) {
    return (180 * v) / Math.PI;
}
const MIN_LAT = degToRad(-90);
const MAX_LAT = degToRad(90);
const MIN_LON = degToRad(-180);
const MAX_LON = degToRad(180);
const PI_X2 = Math.PI * 2;

const R = 6378137;

function getBoundsOfDistance(point, distance) {
    const lat = point[1];
    const lon = point[0];
    const radLat = degToRad(lat);
    const radLon = degToRad(lon);

    const radDist = distance / R;
    let minLat = radLat - radDist;
    let maxLat = radLat + radDist;

    const MAX_LAT_RAD = MAX_LAT;
    const MIN_LAT_RAD = MIN_LAT;
    const MAX_LON_RAD = MAX_LON;
    const MIN_LON_RAD = MIN_LON;

    let minLng;
    let maxLng;

    if (minLat > MIN_LAT_RAD && maxLat < MAX_LAT_RAD) {
        const deltaLon = Math.asin(Math.sin(radDist) / Math.cos(radLat));
        minLng = radLon - deltaLon;

        if (minLng < MIN_LON_RAD) {
            minLng += PI_X2;
        }

        maxLng = radLon + deltaLon;

        if (maxLng > MAX_LON_RAD) {
            maxLng -= PI_X2;
        }
    } else {
        // A pole is within the distance.
        minLat = Math.max(minLat, MIN_LAT_RAD);
        maxLat = Math.min(maxLat, MAX_LAT_RAD);
        minLng = MIN_LON_RAD;
        maxLng = MAX_LON_RAD;
    }

    return [
        radToDeg(minLng),
        radToDeg(minLat),
        radToDeg(maxLng),
        radToDeg(maxLat),
    ];
}

function getBoundingBox(centerPoint, radiusInKm) {
    var lat_change = radiusInKm / 111.2;
    var lon_change = Math.abs(Math.cos(centerPoint[1] * (Math.PI / 180)));
    return [
        centerPoint[0] - lon_change,
        centerPoint[1] - lat_change,
        centerPoint[0] + lon_change,
        centerPoint[1] + lat_change,
    ];
}
Math.fmod = function (a, b) {
    return Number((a - Math.floor(a / b) * b).toPrecision(8));
};

function displaceLatLng(point, distance, radian) {
    const lat1Radians = degToRad(point[1]);
    const lon1Radians = degToRad(point[0]);
    const distanceRadians = distance / R;
    const lat = Math.asin(
        Math.sin(lat1Radians) * Math.cos(distanceRadians) +
            Math.cos(lat1Radians) * Math.sin(distanceRadians) * Math.cos(radian)
    );
    let lon;
    if (Math.cos(lat) == 0) {
        lon = lon1Radians;
    } else {
        lon =
            Math.fmod(
                lon1Radians -
                    Math.asin(
                        (Math.sin(radian) * Math.sin(distanceRadians)) /
                            Math.cos(lat)
                    ) +
                    Math.PI,
                2 * Math.PI
            ) - Math.PI;
    }
    return [radToDeg(lon), radToDeg(lat)];
}
 function getDistanceSimple(start, end) {
    const accuracy = 1;
    if (start[0] === end[0] && start[1] === end[1]) {
        return 0;
    }
    const slat =degToRad(start[1]);
    const slon = degToRad(start[0]);
    const elat = degToRad(end[1]);
    const elon = degToRad(end[0]);
    const distance = Math.round(
        Math.acos(Math.sin(elat) * Math.sin(slat) + Math.cos(elat) * Math.cos(slat) * Math.cos(slon - elon)) * R
    );

    return Math.round(distance / accuracy) * accuracy;
}
export function onMessage(cb) {
    var zoom = cb.zoom;
    var position = cb.position;
    var distance = cb.distance * 1000;
    var fov = cb.fov /4;
    var azimuth = radToDeg(cb.azimuth);
    var angleDistance = distance / Math.cos(degToRad(fov /2)) ;
    var aroundDistance = Math.sin(degToRad(fov /2))  * angleDistance;

    const latlon = unproject(position);
    const point1 = displaceLatLng(latlon, angleDistance,  degToRad(azimuth + fov/2))
    const point2 = displaceLatLng(latlon, angleDistance,  degToRad(azimuth - fov/2))
    // const dist = getDistanceSimple(point1, point2);
    const point3 = displaceLatLng(latlon, aroundDistance/10,  degToRad(azimuth +90))
    const point4 = displaceLatLng(latlon, aroundDistance/10,  degToRad(azimuth -90))
    // const bbox = getBoundsOfDistance(latlon, distance * 1000);
    const box = {
        type: "MultiPolygon",
        coordinates: [
            [point1,
            point2,
            point4,
            point3,  point1]
        ],
    };
    console.log(cb, azimuth, latlon,point1, point2, fov /2, angleDistance,aroundDistance , point3, point4, JSON.stringify(box) )

    // using tile-cover, figure out which tiles are inside viewshed and put in zxy order
    var satelliteTiles = cover
        .tiles(box, { min_zoom: zoom, max_zoom: zoom })
        .map(function ([x, y, z]) {
            return [z, x, y];
        });

    if (satelliteTiles.length == 0) return;

    var imageTiles = [];

    for (var s = 0; s < satelliteTiles.length; s++) {
        var tile = satelliteTiles[s];
        imageTiles.push(tile);
    }

    var elevations = {};

    //assemble list of elevations, as grandparent tiles of imagery
    for (var t = 0; t < imageTiles.length; t++) {
        var deslashed = imageTiles[t];
        var grandparent = [
            deslashed[0] - 2,
            Math.floor(deslashed[1] / 4),
            Math.floor(deslashed[2] / 4),
        ];
        if (elevations[grandparent]) elevations[grandparent].push(deslashed);
        else elevations[grandparent] = [deslashed];
    }

    var elevationTiles = Object.keys(elevations).map(function (triplet) {
        return triplet.split(",").map(function (num) {
            return parseFloat(num);
        });
    });

    return { getTiles: [imageTiles, elevationTiles] };
}
