import * as common from "./common.mjs";
import type _Plotly from "plotly.js"
declare const Plotly: typeof _Plotly

const source = new EventSource(
    `http://${window.location.hostname}:${common.STATS_FEED_PORT}`,
);

Plotly.newPlot("counter-chart", []);
Plotly.newPlot("average-chart", []);
Plotly.newPlot("timer-chart", []);

// Function to update the chart with the latest data
function updateChart(data: common.Stats) {
    // Create the chart data for each stat
    const counterChartData: Plotly.Data[] = [];
    const averageChartData: Plotly.Data[] = [];
    const timerChartData: Plotly.Data[] = [];

    Object.keys(data).forEach((key) => {
        const stat = data[key];

        switch (stat.kind) {
            case "counter": {
                counterChartData.push({
                    x: [stat.description],
                    y: [stat.counter],
                    type: "bar",
                    name: stat.description,
                });
                break;
            }
            case "average": {
                averageChartData.push({
                    x: [stat.description],
                    y: [average(stat.samples)],
                    type: "bar",
                    name: stat.description,
                });
                break;
            }
            case "timer":{
                timerChartData.push({
                    x: [stat.description],
                    y: [performance.now() - stat.startedAt],
                    type: "bar",
                    name: stat.description,
                });
                break;
            }
        }
    });

    // Update the chart with the new data
    Plotly.react("counter-chart", counterChartData);
    Plotly.react("average-chart", averageChartData);
    Plotly.react("timer-chart", timerChartData);
}

// Update the chart when new data is received
source.addEventListener("message", (e) => {
    const data = JSON.parse(e.data) as common.Stats;
    updateChart(data);
});

function average(xs: number[]): number {
    return xs.reduce((acc, x) => acc + x, 0) / xs.length;
}
