Ext.define('PVE.form.BridgeSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: ['widget.PVE.form.BridgeSelector'],

    bridgeType: 'any_bridge', // bridge, OVSBridge or any_bridge

    store: {
        fields: ['iface', 'active', 'type'],
        filterOnLoad: true,
        sorters: [
            {
                property: 'iface',
                direction: 'ASC',
            },
        ],
    },
    valueField: 'iface',
    displayField: 'iface',
    listConfig: {
        columns: [
            {
                header: gettext('Bridge'),
                dataIndex: 'iface',
                hideable: false,
                width: 100,
            },
            {
                header: gettext('Active'),
                width: 60,
                dataIndex: 'active',
                renderer: Proxmox.Utils.format_boolean,
            },
            {
                header: gettext('Comment'),
                dataIndex: 'comments',
                renderer: Ext.String.htmlEncode,
                flex: 1,
            },
        ],
    },

    setNodename: function (nodename) {
        var me = this;

        if (!nodename || me.nodename === nodename) {
            return;
        }

        me.nodename = nodename;

        me.store.setProxy({
            type: 'proxmox',
            url: '/api2/json/nodes/' + me.nodename + '/network?type=' + me.bridgeType,
        });

        me.store.load();
    },

    initComponent: function () {
        var me = this;

        var nodename = me.nodename;
        me.nodename = undefined;

        me.callParent();

        me.setNodename(nodename);
    },
});
