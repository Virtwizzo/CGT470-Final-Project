// adjust links to original data sources
var distance = new Array(), flight_count = new Array();
var urls = {
  air: "airports.csv", // airports.csv https://gist.githubusercontent.com/mbostock/7608400/raw/airports.csv
  fly: "flights-airport.csv", // flights-airport.csv https://gist.githubusercontent.com/mbostock/7608400/raw/flights.csv: 
  flight_count: "https://gist.githubusercontent.com/mbostock/7608400/raw/flights.csv",
  usa: "https://gist.githubusercontent.com/mbostock/4090846/raw/us.json"
};
var svg = d3.select("svg");
var plot = svg.append("g").attr("id", "plot");
var width  = +svg.attr("width");
var height = +svg.attr("height");
var radius = {min: 6, max: 12};
// placeholder for state data once loaded
var states = null;
// only focus on the continental united states
// https://github.com/d3/d3-geo#geoAlbers
var projection = d3.geoAlbers();
// trigger map drawing
d3.json(urls.usa, drawMap);
/*
 * draw the continental united states
 */
function drawMap(error, map) {
  // determines which ids belong to the continental united states
  // https://gist.github.com/mbostock/4090846#file-us-state-names-tsv
  var isContinental = function(d) {
    var id = +d.id;
    return id < 60 && id !== 2 && id !== 15;
  };
  // filter out non-continental united states
  var old = map.objects.states.geometries.length;
  map.objects.states.geometries = map.objects.states.geometries.filter(isContinental);
  console.log("Filtered out " + (old - map.objects.states.geometries.length) + " states from base map.");
  // size projection to fit continental united states
  // https://github.com/topojson/topojson-client/blob/master/README.md#feature
  states = topojson.feature(map, map.objects.states);
  projection.fitSize([width, height], states);
  // draw base map with state borders
  var base = plot.append("g").attr("id", "basemap");
  var path = d3.geoPath(projection);
  base.append("path")
      .datum(states)
      .attr("class", "land")
      .attr("d", path);
  // draw interior and exterior borders differently
  // https://github.com/topojson/topojson-client/blob/master/README.md#mesh
  // used to filter only interior borders
  var isInterior = function(a, b) { return a !== b; };
  // used to filter only exterior borders
  var isExterior = function(a, b) { return a === b; };
  base.append("path")
      .datum(topojson.mesh(map, map.objects.states, isInterior))
      .attr("class", "border interior")
      .attr("d", path);
  base.append("path")
      .datum(topojson.mesh(map, map.objects.states, isExterior))
      .attr("class", "border exterior")
      .attr("d", path);
  // trigger data drawing
  d3.queue()
    .defer(d3.csv, urls.air, typeAirport)
    .defer(d3.csv, urls.fly, typeFlight)
    .defer(d3.csv, urls.flight_count, getFlightCount)
    .await(filterData);
}
/*
 * see airports.csv
 * convert gps coordinates to number and init degree
 */
function typeAirport(d) {
  d.longitude = +d.longitude;
  d.latitude = +d.latitude;
  d.degree = 0;
  return d;
}
/*
 * see flights.csv
 * convert count to number and init segments
 */
function typeFlight(d) {
  
  distance.push(d);
  d.distance = +d.distance;
  return d;
}

function getFlightCount(d)
{
  d.count = parseInt(d.count);
  flight_count.push(d);
}

/*
 * we need a much smaller subgraph for edge bundling
 */
function filterData(error, airports, flights) {
  if(error) throw error;
  // get map of airport objects by iata value
  // international air transport association (iata)
  var byiata = d3.map(airports, function(d) { return d.iata; });
  console.log("Loaded " + byiata.size() + " airports.");
  // convert links into better format and track node degree
  flights.forEach(function(d) {
    d.source = byiata.get(d.origin);
    if(!d.source) { return; }
    d.target = byiata.get(d.destination);
    d.source.degree = d.source.degree + 1;
    d.target.degree = d.target.degree + 1;
  });
  delete flights[79];
  // filter out airports outside of projection
  // or those without a valid state (i.e. d.state === "NA")
  // https://github.com/d3/d3-geo#geoContains
  var old = airports.length;
  airports = airports.filter(function(d) {
    return d3.geoContains(states, [d.longitude, d.latitude]) && d.state !== "NA";
  });
  console.log("Filtered " + (old - airports.length) + " out of bounds airports.");
  // function to sort airports by degree
  var bydegree = function(a, b) {
    return d3.descending(a.degree, b.degree);
  };
  // uncomment nest to show airport with highest degree per state
  // uncomment slice to show top 50 airports by degree
  // uncomment both to see everything break because there are too many airports
  // nest airports by state and reduce to maximum degree airport per state
  // https://github.com/d3/d3-collection#nests
  // airports = d3.nest()
  //   .key(function(d) { return d.state; })
  //   .rollup(function(leaves) {
  //     leaves.sort(bydegree);
  //     return leaves[0];
  //   })
  //   .map(airports)
  //   .values();
  // sort remaining airports by degree
  airports.sort(bydegree);
  airports = airports.slice(0, 50);
  // calculate projected x, y pixel locations
  airports.forEach(function(d) {
    var coords = projection([d.longitude, d.latitude]);
    d.x = coords[0];
    d.y = coords[1];
  });
  // reset map to only contain airports post filter
  byiata = d3.map(airports, function(d) { return d.iata; });
  // filter out flights that do not go between remaining airports
  old = flights.length;
  flights = flights.filter(function(d) {
    return byiata.has(d.source.iata) && byiata.has(d.target.iata);
  });
  console.log("Removed " + (old - flights.length) + " flights.");
  console.log("Currently " + airports.length + " airports remaining.");
  console.log("Currently " + flights.length + " flights remaining.");
  // start drawing everything
  drawData(byiata.values(), flights);
}
/*
 * draw airports and flights using edge bundling
 */
function drawData(airports, flights) {
  // color
  var scheme = d3.schemeReds[6];
  scheme.shift();
  var scale = d3.scaleOrdinal(d3.schemeReds[6]);

  function getCO2(d, call="plot")
  {
    var start = d[0].iata, end = d[d.length - 1].iata;
    var count = flight_count.find(function(i) { return i.origin == start && i.destination == end; }).count;
    var flight_distance = distance.find(function(i) { return i.origin == start && i.destination == end; }).distance * 1.609344; // mi to km
    var CO2 = 90.7 * count * flight_distance * 0.285 / 1000; // tonnes
    
    if(call == "plot")
    { return scale(CO2 / 120000); }
    else if(call == "mouseover")
    { return [CO2, count]; }
  }//getCO2

  function getCount(d)
  {
    var start = d[0].iata, end = d[d.length - 1].iata;
    var count = flight_count.find(function(i) { return i.origin == start && i.destination == end; }).count;

    return Math.ceil(count / 180);
  }//getColor

  var div = d3.select('body').append('div')
    .attr('class', 'tooltip-flights')
    .style('display', 'none');

  function mouseover(){
    div.style('display', 'inline');
  }
  function mousemove(){
    var d = d3.select(this).data()[0];
    var co2data = getCO2(d, "mouseover");
    div
        .html('Carbon Emission of ' + d[0].iata + " - " + d[d.length - 1].iata + ':<br />' + Math.round(co2data[0]).toLocaleString() + ' metric tons from ' + co2data[1].toLocaleString() + ' flights')
        .style('left', (d3.event.pageX - 34) + 'px')
        .style('top', (d3.event.pageY - 12) + 'px');
  }
  function mouseout(){
    div.style('display', 'none');
  }

  // setup and start edge bundling
  var bundle = generateSegments(airports, flights);
  // https://github.com/d3/d3-shape#curveBundle
  var line = d3.line()
    .curve(d3.curveBundle)
    .x(function(d) { return d.x; })
    .y(function(d) { return d.y; });
  var links = plot.append("g").attr("id", "flights")
    .selectAll("path.flight")
    .data(bundle.paths)
    .enter()
    .append("path")
    .attr("d", line)
    .style("fill", "none")
    .style("stroke", function(d) { return getCO2(d); } )
    .style("stroke-width", function(d) { return getCount(d); } )
    .style("stroke-opacity", 1)
    .on("mouseover", mouseover)
    .on("mousemove", mousemove)
    .on("mouseout", mouseout);
    
  // https://github.com/d3/d3-force
  var layout = d3.forceSimulation()
    // settle at a layout faster
    .alphaDecay(0.1)
    // nearby nodes attract each other
    .force("charge", d3.forceManyBody()
      .strength(10)
      .distanceMax(radius.max * 2)
    )
    // edges want to be as short as possible
    // prevents too much stretching
    .force("link", d3.forceLink()
      .strength(0.8)
      .distance(0)
    )
    .on("tick", function(d) {
      links.attr("d", line);
    })
    .on("end", function(d) {
      console.log("Layout complete!");
    });
  layout.nodes(bundle.nodes).force("link").links(bundle.links);
  // draw airports
  var scale = d3.scaleSqrt()
    .domain(d3.extent(airports, function(d) { return d.degree; }))
    .range([radius.min, radius.max]);
  plot.append("g").attr("id", "airports")
    .selectAll("circle.airport")
    .data(airports)
    .enter()
    .append("circle")
    .attr("r", function(d) { return scale(d.degree); })
    .attr("cx", function(d) { return d.x; })
    .attr("cy", function(d) { return d.y; })
    .style("fill", "white")
    .style("opacity", 0.6)
    .style("stroke", "#252525")
    .on("mouseover", onMouseOver)
    .on("mousemove", onMouseMove)
    .on("mouseout", onMouseOut);
}
/*
 * Turns a single edge into several segments that can
 * be used for simple edge bundling.
 */
function generateSegments(nodes, links) {
  // calculate distance between two nodes
  var distance = function(source, target) {
    // sqrt( (x2 - x1)^2 + (y2 - y1)^2 )
    var dx2 = Math.pow(target.x - source.x, 2);
    var dy2 = Math.pow(target.y - source.y, 2);
    return Math.sqrt(dx2 + dy2);
  };
  // max distance any two nodes can be apart is the hypotenuse!
  var hypotenuse = Math.sqrt(width * width + height * height);
  // number of inner nodes depends on how far nodes are apart
  var inner = d3.scaleLinear()
    .domain([0, hypotenuse])
    .range([1, 15]);
  // generate separate graph for edge bundling
  // nodes: all nodes including control nodes
  // links: all individual segments (source to target)
  // paths: all segments combined into single path for drawing
  var bundle = {nodes: [], links: [], paths: []};
  // make existing nodes fixed
  bundle.nodes = nodes.map(function(d, i) {
    d.fx = d.x;
    d.fy = d.y;
    return d;
  });
  links.forEach(function(d, i) {
    // calculate the distance between the source and target
    var length = distance(d.source, d.target);
    // calculate total number of inner nodes for this link
    var total = Math.round(inner(length));
    // create scales from source to target
    var xscale = d3.scaleLinear()
      .domain([0, total + 1]) // source, inner nodes, target
      .range([d.source.x, d.target.x]);
    var yscale = d3.scaleLinear()
      .domain([0, total + 1])
      .range([d.source.y, d.target.y]);
    // initialize source node
    var source = d.source;
    var target = null;
    // add all points to local path
    var local = [source];
    for (var j = 1; j <= total; j++) {
      // calculate target node
      target = {
        x: xscale(j),
        y: yscale(j)
      };
      local.push(target);
      bundle.nodes.push(target);
      bundle.links.push({
        source: source,
        target: target
      });
      source = target;
    }
    local.push(d.target);
    // add last link to target node
    bundle.links.push({
      source: target,
      target: d.target
    });
    bundle.paths.push(local);
  });
  return bundle;
}

//legend
var scheme = d3.schemeReds[6];
scheme.shift();
var w = 300, h = 50;

var key = d3.select("#legend1")
  .append("svg")
  .attr("width", w)
  .attr("height", h);

var legend = key.append("defs")
  .append("svg:linearGradient")
  .attr("id", "gradient")
  .attr("x1", "0%")
  .attr("y1", "100%")
  .attr("x2", "100%")
  .attr("y2", "100%")
  .attr("spreadMethod", "pad");

legend.append("stop")
  .attr("offset", "0%")
  .attr("stop-color", scheme[0])
  .attr("stop-opacity", 1);

legend.append("stop")
  .attr("offset", "33%")
  .attr("stop-color", scheme[1])
  .attr("stop-opacity", 1);

legend.append("stop")
  .attr("offset", "66%")
  .attr("stop-color", scheme[2])
  .attr("stop-opacity", 1);

legend.append("stop")
  .attr("offset", "100%")
  .attr("stop-color", scheme[3])
  .attr("stop-opacity", 1);

key.append("rect")
  .attr("width", w)
  .attr("height", h - 30)
  .style("fill", "url(#gradient)")
  .attr("transform", "translate(0,10)");

var y = d3.scaleLinear()
  .range([300, 0])
  .domain([108000, -470]);

var yAxis = d3.axisBottom()
  .scale(y)
  .tickValues([0, 100000]);

key.append("g")
  .attr("class", "y axis")
  .attr("transform", "translate(0,30)")
  .call(yAxis)
  .append("text")
  .attr("transform", "rotate(-90)")
  .attr("y", 0)
  .attr("dy", ".71em")
  .style("text-anchor", "end")
  .text("axis title");
