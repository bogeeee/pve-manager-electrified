Ext.define('PVE.form.VlanField', {
    extend: 'Ext.form.field.Number',
    alias: ['widget.pveVlanField'],

    deleteEmpty: false,

    emptyText: gettext('no VLAN'),

    fieldLabel: gettext('VLAN Tag'),

    allowBlank: true,

    getSubmitData: function () {
        var me = this,
            data = null,
            val;
        if (!me.disabled && me.submitValue) {
            val = me.getSubmitValue();
            if (val) {
                data = {};
                data[me.getName()] = val;
            } else if (me.deleteEmpty) {
                data = {};
                data.delete = me.getName();
            }
        }
        return data;
    },

    initComponent: function () {
        var me = this;

        Ext.apply(me, {
            minValue: 1,
            maxValue: 4094,
        });

        me.callParent();
    },
});
