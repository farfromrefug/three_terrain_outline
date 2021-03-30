var basePlaneDimension = 65024;
// var mercator = new sm({size: basePlaneDimension});
var elevationCache = {};

var demCache = [];

for (var i=0; i<22; i++){
    demCache.push([])
}


// export function getCenter(){
//     var pt = controls.target;
//     var lngLat = mercator.ll([pt.x+basePlaneDimension/2, pt.z+basePlaneDimension/2],0);
//     return lngLat.map(function(num){return roundTo(num,4)})
// }

export function mPerPixel(latitude, tileSize, zoom) {
    return Math.abs(
    	40075000 * Math.cos(latitude*Math.PI/180) / (Math.pow(2,zoom) * tileSize )
    );
}


export function slashify(input){
    return input.join('/');
}

function deslash(input){
    return input.split('/').map(function(str){return parseInt(str)});
}


export function getBaseLog(base, result) {
  return Math.log(result) / Math.log(base);
}



//project screen coordinates to scene coordinates

// function projectToScene(px){
// 	var screenPosition = {x: (px[0]/width-0.5)*2, y:(0.5-px[1]/height)*2};
// 	raycaster.setFromCamera(screenPosition, camera);
//     var pt = raycaster.intersectObject(plane)[0].point;
//     return pt
// }


//scene coordinates to lngLat (as intersecting with plane)
// function unproject(pt){
//     var lngLat = mercator.ll([pt.x+basePlaneDimension/2, pt.y+basePlaneDimension/2],0);
//     return lngLat
// }




var totalCount = 49152;
var rowCount = 384
//above, left, below, right
var neighborTiles = [[0,0,-1],[0,-1,0],[0,0,1],[0,1,0]];
var row = [[],[],[],[]];

//get specific pixel indices of each edge
for (var c=0; c<rowCount; c+=3) {
    //top, left, bottom, right
    row[0].push(c+1);
    row[1].push(c/3*(rowCount)+1);
    row[2].push(c+1+totalCount-rowCount);
    row[3].push((c/3+1)*(rowCount)-2);
}

//fill seam between elevation tiles by adopting the edge of neighboring tiles
export function resolveSeams(scene, data, [z,x,y]){
    //iterate through neighbors
    neighborTiles.forEach(function(tile, index){

        //figure out neighbor tile coordinate
        var targetTile = tile.map(function(coord,index){
            return coord+[z,x,y][index]
        })

        //if neighbor exists,
        var neighbor = scene.getObjectByProperty('coords',slashify(targetTile));
        if (neighbor){
            // indices that need to be overwritten
            var indicesToChange = row[index];
            //indices of neighbor vertices to copy
            var neighborIndices = row[(index+2)%4];
            var neighborVertices = neighbor.geometry.attributes.position.array;

            for (var a = 0; a<128;a++){
                data[indicesToChange[a]] = neighborVertices[neighborIndices[a]]
            }
        }
    })
    return data
}

