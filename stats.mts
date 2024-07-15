import * as common from "./common.mjs";

const $ = document.querySelector.bind(document);
declare const Plotly: any //TODO: Add typings for this lib

const source = new EventSource(
    `http://${window.location.hostname}:${common.STATS_FEED_PORT}`,
);
const target = $("#root");
if (!target) throw new Error("Event target element not found.");

// Create the chart div
const chartDiv = document.createElement("div");
chartDiv.id = "chart";
target.appendChild(chartDiv);

// Initialize the chart
Plotly.newPlot("chart", []);

// Function to update the chart with the latest data
function updateChart(data: common.Stats) {
    // Create the chart data for each stat
    const chartData = Object.keys(data).map((key) => {
        const stat = data[key];
        switch (stat.kind) {
            case "counter":
                return {
                    x: [stat.description],
                    y: [stat.counter],
                    type: "bar",
                    name: stat.description,
                };
            case "average":
                return {
                    x: [stat.description],
                    y: [common.average(stat.samples)],
                    type: "bar",
                    name: stat.description,
                };
            case "timer":
                return {
                    x: [stat.description],
                    y: [performance.now() - stat.startedAt],
                    type: "bar",
                    name: stat.description,
                };
        }
    });

    // Update the chart with the new data
    Plotly.react("chart", chartData);
}

// Update the chart when new data is received
source.addEventListener("message", (e) => {
    const data = JSON.parse(e.data) as common.Stats;
    updateChart(data);
});
