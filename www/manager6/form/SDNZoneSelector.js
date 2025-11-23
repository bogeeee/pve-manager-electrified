Ext.define(
    'PVE.form.SDNZoneSelector',
    {
        extend: 'Proxmox.form.ComboGrid',
        alias: ['widget.pveSDNZoneSelector'],

        allowBlank: false,
        valueField: 'zone',
        displayField: 'zone',

        initComponent: function () {
            var me = this;

            var store = new Ext.data.Store({
                model: 'pve-sdn-zone',
                sorters: {
                    property: 'zone',
                    direction: 'ASC',
                },
            });

            Ext.apply(me, {
                store: store,
                autoSelect: false,
                listConfig: {
                    columns: [
                        {
                            header: gettext('Zone'),
                            sortable: true,
                            dataIndex: 'zone',
                            flex: 1,
                        },
                    ],
                },
            });

            me.callParent();

            store.load();
        },
    },
    function () {
        Ext.define('pve-sdn-zone', {
            extend: 'Ext.data.Model',
            fields: ['zone', 'type'],
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/sdn/zones',
            },
            idProperty: 'zone',
        });
    },
);
