'use strict';

const hoi = require('ho-iter');
const series = hoi.series;

const VertexSet = require('./vertex-set');
const CircularDependencyError = require('./circular-dependency-error');

module.exports = resolve;

class TopoGroups {
    constructor() {
        this._groups = [];
        this._index = Object.create(null);
    }
    get index() {
        return Object.assign(Object.create(null), this._index);
    }
    get groups() {
        return [].concat(this._groups);
    }
    lookup(id) {
        if (this._index[id]) {
            return this._index[id];
        }
        // console.log('looking for ' + id);
        for (let i = this._groups.length - 1; i >= 0; i -= 1) {
            const group = this._groups[i];
            // console.log('group', group);
            if (group.has(id)) {
                // console.log('found ' + id);
                this._index[id] = group;
                return group;
            }
        }
    }
    lookupCreate(id) {
        let res = this.lookup(id);
        if (!res) {
            res = new Set([id]);
            this._index[id] = res;
            this._groups.push(res);
        }
        return res;
    }
    merge(vertexId, parentId) {
        const parentGroup = this.lookupCreate(parentId);
        const vertexGroup = this.lookup(vertexId);

        if (!vertexGroup) {
            parentGroup.add(vertexId);
        } else if (parentGroup !== vertexGroup) {
            vertexGroup.forEach(id => {
                this._index[id] = parentGroup;
                parentGroup.add(id);
            });
            this.drop(vertexGroup);
        }
    }
    drop(group) {
        if (this._groups.indexOf(group) !== -1) {
            this._groups.splice(this._groups.indexOf(group), 1);
        }
    }
}

function resolve(mixedGraph, startVertices, tech, backsort) {
    const orderedSuccessors = []; // L ← Empty list that will contain the sorted nodes
    const _orderedVisits = {}; // Hash with visiting flags: temporary - false, permanently - true
    const unorderedSuccessors = new VertexSet(); // The rest nodes
    let crumbs = [];
    const topo = new TopoGroups();

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

    return series(_orderedSuccessors, _unorderedSuccessors);

    function visit(fromVertex, weak) {
        //console.log('visit', crumbs.map(v => v.id).join('→'), weak, fromVertex.id, ''+Object.keys(_orderedVisits));

        // ... if n has a temporary mark then stop (not a DAG)
        if (!weak && _orderedVisits[fromVertex.id] === false) {
            if (crumbs.filter(c => (c.entity.id === fromVertex.entity.id) &&
                (!c.tech || c.tech === fromVertex.tech)).length) {
                throw new CircularDependencyError(crumbs.concat(fromVertex)); // TODO: правильно считать цикл
            }
        }

        // ... if n is not marked (i.e. has not been visited yet) then ... else already visited
        if (_orderedVisits[fromVertex.id] !== undefined) {
            // Already visited
            return;
        }

        crumbs.push(fromVertex);

        // ... mark n temporarily
        _orderedVisits[fromVertex.id] = false;

        topo.lookupCreate(fromVertex.id);

        // ... for each node m with an edge from n to m do
        const orderedDirectSuccessors = mixedGraph.directSuccessors(fromVertex, { ordered: true, tech });

        for (let successor of orderedDirectSuccessors) {
            if (successor.id === fromVertex.id) { // TODO: Filter loops earlier
                continue;
            }

            if (weak) {
                // TODO: Very slow piece of shit
                const topogroup = topo.lookup(successor.id);
                if (topogroup && !topogroup.has(fromVertex.id)) {
                    // Drop all entities for the current topogroup if came from unordered
                    Array.from(topo.lookup(successor.id) || []).forEach(id => { _orderedVisits[id] = undefined; });
                }
                // console.log('topolength: ', topogroups.length, Array.from(findTopoGroup(successor.id) || []));
            }

            // Add to topogroup for ordered dependencies to sort them later in groups
            topo.merge(fromVertex.id, successor.id);

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
