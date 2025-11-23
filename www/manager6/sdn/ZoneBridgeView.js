Ext.define('ZoneBridge', {
    extend: 'Ext.data.Model',
    fields: ['name', 'vlan_filtering', 'ports'],
});

Ext.define('PVE.sdn.ZoneBridgeView', {
    extend: 'Ext.grid.GridPanel',
    alias: 'widget.pveSDNZoneBridgeView',

    stateful: true,
    stateId: 'grid-sdnzone-bridges',

    viewConfig: {
        trackOver: false,
        loadMask: false,
    },

    columns: [
        {
            header: gettext('Bridge'),
            width: 100,
            sortable: true,
            dataIndex: 'name',
            flex: 1,
        },
        {
            header: gettext('VLAN-aware'),
            width: 300,
            sortable: true,
            dataIndex: 'vlan_filtering',
            flex: 1,
            renderer: function (value) {
                return value === 1 ? gettext('Yes') : gettext('No');
            },
        },
    ],

    on_select: function (selectionModel, record) {
        // do nothing by default
    },

    on_deselect: function () {
        // do nothing by default
    },

    initComponent: function () {
        var me = this;

        if (!me.nodename) {
            throw 'no node name specified';
        }

        if (!me.zone) {
            throw 'no zone ID specified';
        }

        let baseUrl = `/nodes/${me.nodename}/sdn/zones/${me.zone}/bridges`;

        let store = Ext.create('Ext.data.Store', {
            model: 'ZoneBridge',
            proxy: {
                type: 'proxmox',
                url: '/api2/json' + baseUrl,
            },
            sorters: {
                property: 'name',
                direction: 'ASC',
            },
        });

        let reload = function () {
            store.load();
        };

        Proxmox.Utils.monStoreErrors(me, store);
        Ext.apply(me, {
            store: store,
            listeners: {
                activate: reload,
                show: reload,
                select: me.on_select,
                deselect: me.on_deselect,
            },
        });
        store.load();
        me.callParent();
    },
});
