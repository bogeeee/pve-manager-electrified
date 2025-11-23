Ext.define(
    'PVE.form.SDNControllerSelector',
    {
        extend: 'Proxmox.form.ComboGrid',
        alias: ['widget.pveSDNControllerSelector'],

        allowBlank: false,
        valueField: 'controller',
        displayField: 'controller',

        initComponent: function () {
            var me = this;

            var store = new Ext.data.Store({
                model: 'pve-sdn-controller',
                sorters: {
                    property: 'controller',
                    direction: 'ASC',
                },
            });

            Ext.apply(me, {
                store: store,
                autoSelect: false,
                listConfig: {
                    columns: [
                        {
                            header: gettext('Controller'),
                            sortable: true,
                            dataIndex: 'controller',
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
        Ext.define('pve-sdn-controller', {
            extend: 'Ext.data.Model',
            fields: ['controller'],
            proxy: {
                type: 'proxmox',
                url: '/api2/json/cluster/sdn/controllers',
            },
            idProperty: 'controller',
        });
    },
);
