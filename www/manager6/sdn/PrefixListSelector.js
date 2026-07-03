Ext.define('PVE.sdn.PrefixListSelector', {
    extend: 'Proxmox.form.ComboGrid',
    alias: 'widget.pveSDNPrefixListSelector',

    displayField: 'id',

    deleteEmpty: true,
    editable: false,
    allowBlank: true,
    autoSelect: false,

    store: {
        autoLoad: true,
        model: 'PVE.sdn.PrefixList',
        proxy: {
            type: 'proxmox',
            url: '/api2/json/cluster/sdn/prefix-lists',
        },
    },
    listConfig: {
        columns: [
            {
                header: gettext('Name'),
                dataIndex: 'id',
                hideable: false,
                flex: 1,
            },
        ],
    },
});
