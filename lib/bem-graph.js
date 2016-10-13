'use strict';

const debug = require('debug')('bem-graph');
const BemCell = require('@bem/cell');
const BemEntityName = require('@bem/entity-name');
const hoi = require('ho-iter');
const series = hoi.series;
const reverse = hoi.reverse;

const VertexSet = require('./vertex-set');
const MixedGraph = require('./mixed-graph');
const CircularDependencyError = require('./circular-dependency-error');

class BemGraph {
    constructor() {
        this._mixedGraph = new MixedGraph();
    }
    vertex(entity, tech) {
        const mixedGraph = this._mixedGraph;

        const vertex = new BemCell({ entity: new BemEntityName(entity), tech });

        mixedGraph.addVertex(vertex);

        return new BemGraph.Vertex(this, vertex);
    }
    naturalDependenciesOf(entities, tech) {
        return this.dependenciesOf(this._sortNaturally(entities), tech);
    }
    dependenciesOf(entities, tech) {
        if (!Array.isArray(entities)) {
            entities = [entities];
        }

        const vertices = entities.reduce((res, entity) => {
            const entityName = new BemEntityName(entity);

            res.push(new BemCell({ entity: entityName }));

            // Multiply techs
            tech && res.push(new BemCell({ entity: entityName, tech }));

            return res;
        }, []);

        // Recommended order
        const _positions = vertices.reduce((res, e, pos) => { res[e.id] = pos + 1; return res; }, {});
        const _sort = (a, b) => _positions[a.id] - _positions[b.id];

        const iter = this._dependenciesOf(vertices, tech, _sort);
        const arr = Array.from(iter);

        // TODO: returns iterator
        const verticesCheckList = {};
        return arr.map(vertex => {
            if (verticesCheckList[`${vertex.entity.id}.${(vertex.tech || tech)}`]) {
                return false;
            }

            const obj = { entity: vertex.entity.valueOf() };

            (vertex.tech || tech) && (obj.tech = vertex.tech || tech);
            verticesCheckList[`${vertex.entity.id}.${obj.tech}`] = true;

            return obj;
        }).filter(Boolean);
    }
    _dependenciesOf(startVertices, tech, backsort) {
        const mixedGraph = this._mixedGraph;
        const orderedSuccessors = []; // L ← Empty list that will contain the sorted nodes
        const _orderedVisits = {}; // Hash with visiting flags: temporary - false, permanently - true
        const unorderedSuccessors = new VertexSet(); // The rest nodes
        let crumbs = [];

        const topogroups = [];
        const topoindex = Object.create(null);

        // ... while there are unmarked nodes do
        startVertices.forEach(v => visit(v, false));

        const _orderedSuccessors = Array.from(new VertexSet(orderedSuccessors.reverse()));
        const _unorderedSuccessors = Array.from(unorderedSuccessors).sort(backsort);
        // console.log({topogroups, ordered: Array.from(_orderedSuccessors).map(v => v.id), unordered: Array.from(_unorderedSuccessors).map(v => v.id)});

        // const res = topogroups.reduce((r, topogroup) => {
        //     _orderedSuccessors.filter(v => topogroup.has(v.id)).forEach(v => r.push(v));
        //     _unorderedSuccessors.filter(v => topogroup.has(v.id)).forEach(v => r.push(v));
        //     return r;
        // }, []);
        //const res = .concat();

        // console.log('res:', res.map(v => v.id));

        return series(_orderedSuccessors, _unorderedSuccessors); //_orderedSuccessors, _unorderedSuccessors);

        function findTopoGroup(id, make) {
            if (topoindex[id]) { return topoindex[id]; }
            // console.log('looking for ' + id);
            for (let i = topogroups.length - 1; i >= 0; i -= 1) {
                const topogroup = topogroups[i];
                // console.log('group', topogroup);
                if (topogroup.has(id)) {
                    // console.log('found ' + id);
                    topoindex[id] = topogroup;
                    return topogroup;
                }
            }
            if (!make) {
                return;
            }
            // console.log('newww', topogroups, Object.keys(topoindex));
            const res = new Set([id]);
            topoindex[id] = res;
            topogroups.push(res);
            return res;
        }
        function mergeTopoGroups(parentId, vertexId) {
            let parentGroup = findTopoGroup(parentId, true);
            let vertexGroup = findTopoGroup(vertexId);

            if (!vertexGroup) {
                parentGroup.add(vertexId);
            } else if (parentGroup !== vertexGroup) {
                vertexGroup.forEach(id => parentGroup.add(id));
                if(topogroups.indexOf(vertexGroup) !== -1) {
                    topogroups.splice(topogroups.indexOf(vertexGroup), 1);
                }
                topoindex[vertexId] = parentGroup;
            }
        }

        function visit(fromVertex, weak) {
            //console.log('visit', crumbs.map(v => v.id).join('→'), weak, fromVertex.id, ''+Object.keys(_orderedVisits));

            // ... if n has a temporary mark then stop (not a DAG)
            if (!weak && _orderedVisits[fromVertex.id] === false) {
                // console.log('THROW', weak, crumbs.map(v => v.id));
                throw new CircularDependencyError(crumbs.concat(fromVertex)); // TODO: правильно считать цикл
            }

            // ... if n is not marked (i.e. has not been visited yet) then ... else already visited
            if (_orderedVisits[fromVertex.id] !== undefined) {
                // Already visited
                return;
            }

            crumbs.push(fromVertex);

            // ... mark n temporarily
            _orderedVisits[fromVertex.id] = false;

            findTopoGroup(fromVertex.id, true);

            // ... for each node m with an edge from n to m do
            const orderedDirectSuccessors = mixedGraph.directSuccessors(fromVertex, { ordered: true, tech });

            for (let successor of orderedDirectSuccessors) {
                if (successor.id === fromVertex.id) { // TODO: Filter loops earlier
                    continue;
                }

                if (weak) {
                    // TODO: Very slow piece of shit
                    const topogroup = findTopoGroup(successor.id);
                    if (topogroup && !topogroup.has(fromVertex.id)) {
                        // Drop all entities for the current topogroup if came from unordered
                        Array.from(findTopoGroup(successor.id) || []).forEach(id => { _orderedVisits[id] = undefined; });
                    }
                    // console.log('topolength: ', topogroups.length, Array.from(findTopoGroup(successor.id) || []));
                }

                // Add to topogroup for ordered dependencies to sort them later in groups
                mergeTopoGroups(fromVertex.id, successor.id);

                visit(successor, false);
            }

            // ... mark n permanently
            // ... unmark n temporarily
            _orderedVisits[fromVertex.id] = true;

            // ... add n to head of L
            weak || orderedSuccessors.unshift(fromVertex);
            weak && unorderedSuccessors.add(fromVertex);

            const unorderedDirectSuccessors = mixedGraph.directSuccessors(fromVertex, { ordered: false, tech });

            for (let successor of unorderedDirectSuccessors) {
                // console.log('unordered', successor.id);
                if (successor.id === fromVertex.id || // TODO: Filter loops earlier
                    _orderedVisits[successor.id] ||
                    unorderedSuccessors.has(successor) ||
                    orderedSuccessors.indexOf(successor) !== -1) {
                    continue;
                }

                const _crumbs = crumbs;
                //console.log('remember ', crumbs.map(v => v.id).join('->'));
                crumbs = [];

                visit(successor, true);

                crumbs = _crumbs;
            }

            crumbs.pop();
        }
    }
    naturalize() {
        const mixedGraph = this._mixedGraph;

        const vertices = Array.from(mixedGraph.vertices());
        const index = {};
        for (let vertex of vertices) {
            index[vertex.id] = vertex;
        }

        function hasOrderedDepend(vertex, depend) {
            const orderedDirectSuccessors = mixedGraph.directSuccessors(vertex, { ordered: true });

            for (let successor of orderedDirectSuccessors) {
                if (successor.id === depend.id) {
                    return true;
                }
            }

            return false;
        }

        function addEdgeLosely(vertex, key) {
            const dependant = index[key];

            if (dependant) {
                if (hasOrderedDepend(dependant, vertex)) {
                    return false;
                }

                mixedGraph.addEdge(vertex, dependant, {ordered: true});
                return true;
            }

            return false;
        }

        for (let vertex of vertices) {
            const entity = vertex.entity;

            // Elem modifier should depend on elen by default
            if (entity.elem && (entity.mod && entity.mod.name || entity.modName)) {
                (entity.mod.val !== true) &&
                    addEdgeLosely(vertex, `${entity.block}__${entity.elem}_${entity.mod.name || entity.modName}`);

                addEdgeLosely(vertex, `${entity.block}__${entity.elem}`) ||
                    addEdgeLosely(vertex, entity.block);
            }
            // Elem should depend on block by default
            else if (entity.elem) {
                addEdgeLosely(vertex, entity.block);
            }
            // Block modifier should depend on block by default
            else if (entity.mod && entity.mod.name || entity.modName) {
                (entity.mod.val !== true) &&
                    addEdgeLosely(vertex, `${entity.block}_${entity.mod.name || entity.modName}`);

                addEdgeLosely(vertex, entity.block);
            }
        }
    }
    _sortNaturally(entities) {
        const order = {};
        let idx = 0;
        for (let entity of entities) {
            entity.id || (entity.id = (new BemEntityName(entity)).id);
            order[entity.id] = idx++;
        }

        let k = 1;
        for (let entity of entities) {
            // Elem should depend on block by default
            if (entity.elem && !entity.modName) {
                order[entity.block] && (order[entity.id] = order[entity.block] + 0.001*(k++));
            }
        }

        // Block/Elem boolean modifier should depend on elem/block by default
        for (let entity of entities) {
            if (entity.modName && entity.modVal === true) {
                let depId = `${entity.block}__${entity.elem}`;
                order[depId] || (depId = entity.block);
                order[depId] && (order[entity.id] = order[depId] + 0.00001*(k++));
            }
        }

        // Block/Elem key-value modifier should depend on boolean modifier, elem or block by default
        for (let entity of entities) {
            if (entity.modName && entity.modVal !== true) {
                let depId = entity.elem
                    ? `${entity.block}__${entity.elem}_${entity.modName}`
                    : `${entity.block}_${entity.modName}`;
                order[depId] || entity.elem && (depId = `${entity.block}__${entity.elem}`);
                order[depId] || (depId = entity.block);
                order[depId] && (order[entity.id] = order[depId] + 0.0000001*(k++));
            }
        }

        return entities.sort((a, b) => order[a.id] - order[b.id]);
    }
}

BemGraph.Vertex = class {
    constructor(graph, vertex) {
        this.graph = graph;
        this.vertex = vertex;
    }
    linkWith(entity, tech) {
        const dependencyVertex = new BemCell({ entity: new BemEntityName(entity), tech });

        debug('link ' + this.vertex.id + ' -> ' + dependencyVertex.id);
        this.graph._mixedGraph.addEdge(this.vertex, dependencyVertex, { ordered: false });

        return this;
    }
    dependsOn(entity, tech) {
        const dependencyVertex = new BemCell({ entity: new BemEntityName(entity), tech });

        debug('link ' + this.vertex.id + ' => ' + dependencyVertex.id);
        this.graph._mixedGraph.addEdge(this.vertex, dependencyVertex, { ordered: true });

        return this;
    }
}

module.exports = BemGraph;
