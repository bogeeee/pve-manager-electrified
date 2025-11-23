Ext.define(
    'PVE.form.SDNVnetSelector',
    {
        extend: 'Proxmox.form.ComboGrid',
        alias: ['widget.pveSDNVnetSelector'],

        allowBlank: false,
        valueField: 'vnet',
        displayField: 'vnet',

        initComponent: function () {
            var me = this;

            var store = new Ext.data.Store({
                model: 'pve-sdn-vnet',
                sorters: {
                    property: 'vnet',
                    direction: 'ASC',
                },
            });

            Ext.apply(me, {
                store: store,
                autoSelect: false,
                listConfig: {
                    columns: [
                        {
                            header: gettext('VNet'),
                            sortable: true,
                            dataIndex: 'vnet',
                            flex: 1,
                        },
                        {
                            header: gettext('Alias'),
                            flex: 1,
                            dataIndex: 'alias',
                        },
                        {
                            header: gettext('Tag'),
                            flex: 1,
                            dataIndex: 'tag',
                        },
                    ],
                },
            });

            me.callParent();

            store.load();
        },
    },
    function () {
        Ext.define('pve-sdn-vnet', {
            extend: 'Ext.data.Model',
            fields: ['alias', 'tag', 'type', 'vnet', 'zone'],
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/sdn/vnets',
            },
            idProperty: 'vnet',
        });
    },
);
