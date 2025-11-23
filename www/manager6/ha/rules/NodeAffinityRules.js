Ext.define('PVE.ha.NodeAffinityRulesView', {
    extend: 'PVE.ha.RulesBaseView',
    alias: 'widget.pveHANodeAffinityRulesView',

    ruleType: 'node-affinity',
    ruleTitle: gettext('HA Node Affinity'),
    inputPanel: 'NodeAffinityInputPanel',
    faIcon: 'map-pin',

    stateful: true,
    stateId: 'grid-ha-node-affinity-rules',

    columns: [
        {
            header: gettext('Strict'),
            width: 75,
            dataIndex: 'strict',
        },
        {
            header: gettext('HA Resources'),
            flex: 3,
            dataIndex: 'resources',
        },
        {
            header: gettext('Nodes'),
            flex: 2,
            dataIndex: 'nodes',
        },
    ],
});
