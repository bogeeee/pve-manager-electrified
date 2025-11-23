Ext.define('PVE.form.DayOfWeekSelector', {
    extend: 'Proxmox.form.KVComboBox',
    alias: ['widget.pveDayOfWeekSelector'],
    comboItems: [],
    initComponent: function () {
        var me = this;
        me.comboItems = [
            ['mon', Ext.util.Format.htmlDecode(Ext.Date.dayNames[1])],
            ['tue', Ext.util.Format.htmlDecode(Ext.Date.dayNames[2])],
            ['wed', Ext.util.Format.htmlDecode(Ext.Date.dayNames[3])],
            ['thu', Ext.util.Format.htmlDecode(Ext.Date.dayNames[4])],
            ['fri', Ext.util.Format.htmlDecode(Ext.Date.dayNames[5])],
            ['sat', Ext.util.Format.htmlDecode(Ext.Date.dayNames[6])],
            ['sun', Ext.util.Format.htmlDecode(Ext.Date.dayNames[0])],
        ];
        this.callParent();
    },
});
