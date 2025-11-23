Ext.define('PVE.form.PCISelector', {
    extend: 'Proxmox.form.ComboGrid',
    xtype: 'pvePCISelector',

    store: {
        fields: ['id', 'vendor_name', 'device_name', 'vendor', 'device', 'iommugroup', 'mdev'],
        filterOnLoad: true,
        sorters: [
            {
                property: 'id',
                direction: 'ASC',
            },
        ],
    },

    autoSelect: false,
    valueField: 'id',
    displayField: 'id',

    // can contain a load callback for the store
    // useful to determine the state of the IOMMU
    onLoadCallBack: undefined,

    listConfig: {
        minHeight: 80,
        width: 800,
        columns: [
            {
                header: 'ID',
                dataIndex: 'id',
                width: 100,
            },
            {
                header: gettext('IOMMU Group'),
                dataIndex: 'iommugroup',
                renderer: (v) => (v === -1 ? '-' : v),
                width: 75,
            },
            {
                header: gettext('Vendor'),
                dataIndex: 'vendor_name',
                flex: 2,
            },
            {
                header: gettext('Device'),
                dataIndex: 'device_name',
                flex: 6,
            },
            {
                header: gettext('Mediated Devices'),
                dataIndex: 'mdev',
                flex: 1,
                renderer: function (val) {
                    return Proxmox.Utils.format_boolean(!!val);
                },
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
            url: '/api2/json/nodes/' + me.nodename + '/hardware/pci',
        });

        me.store.load();
    },

    initComponent: function () {
        var me = this;

        var nodename = me.nodename;
        me.nodename = undefined;

        me.callParent();

        if (me.onLoadCallBack !== undefined) {
            me.mon(me.getStore(), 'load', me.onLoadCallBack);
        }

        me.setNodename(nodename);
    },
});
