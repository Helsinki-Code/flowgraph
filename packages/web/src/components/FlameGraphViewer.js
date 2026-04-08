import React, { useEffect, useRef } from "react";
import * as d3 from "d3";
export function FlameGraphViewer({ tree, width = 1000, height = 600 }) {
    const svgRef = useRef(null);
    useEffect(() => {
        if (!svgRef.current || !tree)
            return;
        // Flatten tree to array for D3
        const nodes = [];
        const visit = (node, depth) => {
            nodes.push({ ...node, depth });
            for (const child of node.children || []) {
                visit(child, depth + 1);
            }
        };
        visit(tree, 0);
        const svg = d3.select(svgRef.current);
        svg.selectAll("*").remove();
        // Color scale
        const colorScale = d3
            .scaleOrdinal()
            .domain(["llm_call", "tool_exec", "context_build", "session", "turn"])
            .range(["#3b82f6", "#f97316", "#10b981", "#8b5cf6", "#ef4444"]);
        // Create g for content
        const g = svg
            .append("g")
            .attr("transform", `translate(0, 0)`);
        // Draw rectangles for each node (simple bar chart per depth level)
        const rowHeight = 24;
        const maxDepth = Math.max(...nodes.map((n) => n.depth || 0));
        const rect = g
            .selectAll("rect")
            .data(nodes)
            .enter()
            .append("rect")
            .attr("x", (d, i) => (i * width) / Math.max(nodes.length, 1))
            .attr("y", (d) => (d.depth || 0) * rowHeight)
            .attr("width", (d) => width / Math.max(nodes.length, 1))
            .attr("height", rowHeight - 2)
            .attr("fill", (d) => colorScale(d.kind))
            .attr("stroke", "#1e293b")
            .attr("stroke-width", 1)
            .style("cursor", "pointer")
            .on("mouseover", function (event, d) {
            d3.select(this).attr("opacity", 0.8);
            // Show tooltip
            const tooltip = d3.select("body")
                .append("div")
                .style("position", "absolute")
                .style("padding", "0.5rem 1rem")
                .style("background", "#1e293b")
                .style("color", "#e2e8f0")
                .style("border", "1px solid #334155")
                .style("border-radius", "0.375rem")
                .style("font-size", "0.875rem")
                .style("pointer-events", "none")
                .style("z-index", "1000")
                .style("left", event.pageX + 10 + "px")
                .style("top", event.pageY + 10 + "px");
            tooltip.html(`<div><strong>${d.name}</strong></div>
           <div>Cost: $${d.costUsd.toFixed(4)}</div>
           <div>Tokens: ${d.tokens}</div>
           <div>Duration: ${d.durationMs.toFixed(0)}ms</div>
           <div>${d.pctOfTotal.toFixed(1)}% of total</div>`);
            d3.select(this).on("mouseout", function () {
                d3.select(this).attr("opacity", 1);
                tooltip.remove();
            });
        });
        // Add labels
        g.selectAll("text")
            .data(nodes)
            .enter()
            .append("text")
            .attr("x", (d, i) => (i * width) / Math.max(nodes.length, 1) + 4)
            .attr("y", (d) => (d.depth || 0) * rowHeight + rowHeight / 2)
            .attr("dy", "0.35em")
            .attr("fill", "#e2e8f0")
            .attr("font-size", "11px")
            .attr("font-family", "monospace")
            .text((d) => d.name.slice(0, 12));
    }, [tree]);
    return (<div style={{ width: "100%", overflow: "auto", background: "#0f172a" }}>
      <svg ref={svgRef} width={width} height={Math.max(300, (Math.max(...(tree?.children?.length || 0), 5) + 1) * 30)} style={{ display: "block", minHeight: "400px" }}/>
    </div>);
}
//# sourceMappingURL=FlameGraphViewer.js.map