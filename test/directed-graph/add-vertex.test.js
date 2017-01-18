'use strict';

const test = require('ava');

const BemEntityName = require('@bem/entity-name');
const BemCell = require('@bem/cell');

const DirectedGraph = require('../../lib/directed-graph');

const vertex = new BemCell({ entity: new BemEntityName({ block: 'button' }) });

test('should be chainable', t => {
    const graph = new DirectedGraph();

    t.is(graph.addVertex(vertex), graph);
});

test('should add vertex', t => {
    const graph = new DirectedGraph();

    graph.addVertex(vertex);

    t.truthy(graph.hasVertex(vertex));
});

test('should add the same vertex only one', t => {
    const graph = new DirectedGraph();

    graph.addVertex(vertex);
    graph.addVertex(vertex);

    const vertices = Array.from(graph.vertices());

    t.is(vertices.length, 1);
});
