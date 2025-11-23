Ext.define('PVE.form.ACMEPluginSelector', {
    extend: 'Ext.form.field.ComboBox',
    alias: 'widget.pveACMEPluginSelector',

    fieldLabel: gettext('Plugin'),
    displayField: 'plugin',
    valueField: 'plugin',

    store: {
        model: 'pve-acme-plugins',
        autoLoad: true,
        filters: (item) => item.data.type === 'dns',
    },

    triggerAction: 'all',
    queryMode: 'local',
    allowBlank: false,
    editable: false,
});
