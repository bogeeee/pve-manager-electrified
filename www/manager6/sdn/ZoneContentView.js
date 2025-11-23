Ext.define(
    'PVE.sdn.ZoneContentView',
    {
        extend: 'Ext.grid.GridPanel',
        alias: 'widget.pveSDNZoneContentView',

        stateful: true,
        stateId: 'grid-sdnzone-content',
        viewConfig: {
            trackOver: false,
            loadMask: false,
        },
        features: [
            {
                ftype: 'grouping',
                groupHeaderTpl: '{name} ({rows.length} Item{[values.rows.length > 1 ? "s" : ""]})',
            },
        ],

        sub_panel: null,

        columns: [
            {
                header: gettext('VNet'),
                width: 100,
                sortable: true,
                dataIndex: 'vnet',
            },
            {
                header: gettext('Alias'),
                width: 300,
                sortable: true,
                dataIndex: 'alias',
            },
            {
                header: gettext('Status'),
                width: 100,
                sortable: true,
                dataIndex: 'status',
            },
            {
                header: gettext('Details'),
                flex: 1,
                dataIndex: 'statusmsg',
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

            var baseurl = '/nodes/' + me.nodename + '/sdn/zones/' + me.zone + '/content';
            if (me.zone === 'localnetwork') {
                baseurl = '/nodes/' + me.nodename + '/network?type=any_local_bridge';
            }
            var store = Ext.create('Ext.data.Store', {
                model: 'pve-sdnzone-content',
                groupField: 'content',
                proxy: {
                    type: 'proxmox',
                    url: '/api2/json' + baseurl,
                },
                sorters: {
                    property: 'vnet',
                    direction: 'ASC',
                },
            });

            var reload = function () {
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
    },
    function () {
        Ext.define('pve-sdnzone-content', {
            extend: 'Ext.data.Model',
            fields: [
                {
                    name: 'iface',
                    convert: function (value, record) {
                        //map local vmbr to vnet
                        if (record.data.iface) {
                            record.data.vnet = record.data.iface;
                        }
                        return value;
                    },
                },
                {
                    name: 'comments',
                    convert: function (value, record) {
                        //map local vmbr comments to vnet alias
                        if (record.data.comments) {
                            record.data.alias = record.data.comments;
                        }
                        return value;
                    },
                },
                'vnet',
                'status',
                'statusmsg',
                {
                    name: 'text',
                    convert: function (value, record) {
                        // check for volid, because if you click on a grouping header,
                        // it calls convert (but with an empty volid)
                        if (value || record.data.vnet === null) {
                            return value;
                        }
                        return PVE.Utils.format_sdnvnet_type(value, {}, record);
                    },
                },
            ],
            idProperty: 'vnet',
        });
    },
);
